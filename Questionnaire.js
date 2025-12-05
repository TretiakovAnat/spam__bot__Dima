const userQuestionnaireStates = new Map();
const { getUserCategory } = require('./Categories');
const { saveQuestionnaireToSheet } = require('./googleSheets');
const { getFullQuestionsForCategory, getQuestionsForCategory } = require('./QuestionManager');
const calendarManager = require('./CalendarManager');
const SessionManager = require('./session/SessionManager');

// Функция для создания безопасного callback_data
function createSafeCallbackData(questionId, optionText) {
  // Ограничиваем длину и убираем специальные символы
  const safeText = optionText
    .replace(/[^a-zA-Z0-9а-яіїєґІЇЄҐ]/g, '')
    .substring(0, 30);
  
  return `ans_${questionId}_${safeText}`;
}

// Функция для извлечения оригинального текста
function extractOriginalText(callbackData, questions, currentQuestionId) {
  if (callbackData.startsWith('ans_')) {
    const parts = callbackData.split('_');
    const questionId = parseInt(parts[1]);
    const safeText = parts.slice(2).join('_');
    
    // Находим вопрос по ID
    const question = questions.find(q => q.id === questionId);
    if (question && question.type === 'options') {
      // Ищем опцию, которая соответствует safeText
      const originalOption = question.options.find(opt => 
        opt.replace(/[^a-zA-Z0-9а-яіїєґІЇЄҐ]/g, '') === safeText
      );
      return originalOption || safeText;
    }
  }
  return callbackData.replace('answer_', '');
}

// Функция для проверки номера телефона
function isValidPhoneNumber(phone) {
  if (!phone) return false;
  
  // Убираем все нецифровые символы
  const cleanPhone = phone.replace(/\D/g, '');
  
  // Проверяем украинские форматы номеров
  const ukrainianPatterns = [
    /^380\d{9}$/, // +380XXXXXXXXX
    /^0\d{9}$/,   // 0XXXXXXXXX
    /^\d{10}$/,   // XXXXXXXXXX
    /^\+380\d{9}$/ // +380XXXXXXXXX
  ];
  
  return ukrainianPatterns.some(pattern => pattern.test(cleanPhone));
}

// Функция для проверки валидности URL
function isValidURL(url) {
  if (!url) return false;
  
  try {
    // Простая проверка формата URL
    const urlPattern = /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/[\w- .\/?%&=]*)?$/;
    return urlPattern.test(url.trim());
  } catch (error) {
    return false;
  }
}

// Начало анкеты
async function startQuestionnaire(bot, query) {
  try {
    const chatId = query.message.chat.id;
    const userId = query.from.id;

    // Сохраняем данные пользователя
    const userData = {
      first_name: query.from.first_name,
      last_name: query.from.last_name,
      username: query.from.username
    };

    // Проверяем категорию пользователя
    const userCategory = getUserCategory(userId);
    if (!userCategory) {
      await bot.sendMessage(chatId, '❌ Спочатку оберіть категорію!');
      return;
    }

    // Начинаем анкету
    userQuestionnaireStates.set(userId, {
      category: userCategory.category,
      categoryName: userCategory.categoryName,
      currentQuestion: 0,
      answers: [],
      chatId: chatId,
      userData: userData
    });

    // Отправляем первый вопрос
    await sendNextQuestion(bot, userId, chatId);

  } catch (error) {
    console.error('Error in startQuestionnaire:', error);
  }
}

// Отправка следующего вопрос
async function sendNextQuestion(bot, userId, chatId) {
  try {
    const state = userQuestionnaireStates.get(userId);
    if (!state) return;

    // Используем полные вопросы для отображения пользователю
    const questions = getFullQuestionsForCategory(state.category);
    
    // Проверяем, есть ли вопросы для этой категории
    if (!questions || questions.length === 0) {
      await bot.sendMessage(chatId, '❌ Для вашої категорії ще не налаштовані питання.');
      userQuestionnaireStates.delete(userId);
      return;
    }

    const currentQuestion = questions[state.currentQuestion];

    if (currentQuestion.type === 'text') {
      await bot.sendMessage(chatId, currentQuestion.question);
    } else if (currentQuestion.type === 'options') {
      const keyboard = currentQuestion.options.map(option => [
        { 
          text: option, 
          callback_data: createSafeCallbackData(currentQuestion.id, option)
        }
      ]);

      await bot.sendMessage(chatId, currentQuestion.question, {
        reply_markup: {
          inline_keyboard: keyboard
        }
      });
    } else if (currentQuestion.type === 'calendar') {
      // Для вопросов типа calendar показываем календарь (только текущий месяц)
      await calendarManager.startCalendarSelection(bot, chatId, userId, currentQuestion.question);
    }

  } catch (error) {
    console.error('Error in sendNextQuestion:', error);
  }
}

// Обработка ответов на вопросы
async function handleQuestionnaireCallback(bot, query) {
  try {
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    const state = userQuestionnaireStates.get(userId);

    if (!state) return;

    // Сначала проверяем, не является ли это callback'ом от календаря
    if (query.data.startsWith('calendar_')) {
      const selectedDate = await calendarManager.handleCalendarCallback(bot, query);
      
      if (selectedDate) {
        // Сохраняем ответ с датой
        const questions = getFullQuestionsForCategory(state.category);
        const currentQuestion = questions[state.currentQuestion];
        const shortQuestions = getQuestionsForCategory(state.category);
        const shortQuestion = shortQuestions[state.currentQuestion].question;
        
        state.answers.push({
          question: shortQuestion,
          fullQuestion: currentQuestion.question,
          answer: selectedDate.toLocaleDateString('uk-UA')
        });

        // Переходим к следующему вопросу
        state.currentQuestion++;

        // Если вопросы закончились
        if (state.currentQuestion >= questions.length) {
          await finishQuestionnaire(bot, userId, chatId, state);
          userQuestionnaireStates.delete(userId);
        } else {
          // Отправляем следующий вопрос
          await sendNextQuestion(bot, userId, chatId);
        }
      }
      return;
    }

    // Остальная обработка обычных ответов
    const questions = getFullQuestionsForCategory(state.category);
    const currentQuestion = questions[state.currentQuestion];

    let answer;
    if (query.data.startsWith('ans_')) {
      answer = extractOriginalText(query.data, questions, currentQuestion.id);
    } else if (query.data.startsWith('answer_')) {
      answer = query.data.replace('answer_', '');
    } else {
      return;
    }

    const shortQuestions = getQuestionsForCategory(state.category);
    const shortQuestion = shortQuestions[state.currentQuestion].question;
    
    state.answers.push({
      question: shortQuestion,
      fullQuestion: currentQuestion.question,
      answer: answer
    });

    state.currentQuestion++;

    await bot.answerCallbackQuery(query.id, { text: '✅ Відповідь збережено' });

    if (state.currentQuestion >= questions.length) {
      await finishQuestionnaire(bot, userId, chatId, state);
      userQuestionnaireStates.delete(userId);
    } else {
      await sendNextQuestion(bot, userId, chatId);
    }

  } catch (error) {
    console.error('Error in handleQuestionnaireCallback:', error);
  }
}

// Обработка текстовых сообщений (ответы на вопросы)
async function handleQuestionnaireMessage(bot, msg) {
  try {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const text = msg.text;
    const state = userQuestionnaireStates.get(userId);

    if (!state || !text) return;

    // Используем полные вопросы для отображения
    const questions = getFullQuestionsForCategory(state.category);
    const currentQuestion = questions[state.currentQuestion];

    // Проверяем, что текущий вопрос текстовый
    if (currentQuestion && currentQuestion.type === 'text') {
      // Проверяем, является ли это вопросом о телефоне
      const isPhoneQuestion = currentQuestion.question.includes('телефон') || 
                             currentQuestion.question.includes('Телефон') ||
                             currentQuestion.question.includes('номер');
      
      // Проверяем, является ли это вопросом о портфолио (только для SMM)
      const isPortfolioQuestion = state.category === 'smm' && 
                                 (currentQuestion.question.includes('портфоліо') || 
                                  currentQuestion.question.includes('Портфоліо') ||
                                  currentQuestion.question.includes('посилання') ||
                                  currentQuestion.question.includes('робіт'));
      
      if (isPhoneQuestion && !isValidPhoneNumber(text)) {
        // Если это вопрос о телефоне и номер невалиден
        await bot.sendMessage(chatId, 
          '❌ Будь ласка, введіть коректний номер телефону у форматі:\n' +
          '• +380XXXXXXXXX\n' +
          '• 0XXXXXXXXX\n' +
          '• XXXXXXXXXX\n\n' +
          'Приклад: +380991234567 або 0991234567'
        );
        return; // Не переходим к следующему вопросу
      }
      
      if (isPortfolioQuestion && !isValidURL(text)) {
        // Если это вопрос о портфолио и введен невалидный URL
        await bot.sendMessage(chatId,
          '❌ Будь ласка, введіть коректне посилання (URL).\n\n' +
          'Приклади валідних посилань:\n' +
          '• https://www.instagram.com/your_profile\n' +
          '• http://example.com/portfolio\n' +
          '• t.me/your_channel\n\n' +
          'Введіть коректне посилання або напишіть "немає" якщо у вас немає портфоліо.'
        );
        return; // Не переходим к следующему вопросу
      }

      // Сохраняем ответ с коротким названием вопроса для Google Таблицы
      const shortQuestions = getQuestionsForCategory(state.category);
      const shortQuestion = shortQuestions[state.currentQuestion].question;
      
      state.answers.push({
        question: shortQuestion, // Короткое название для таблицы
        fullQuestion: currentQuestion.question, // Полный вопрос для отображения
        answer: text
      });

      // Переходим к следующему вопросу
      state.currentQuestion++;

      // Если вопросы закончились
      if (state.currentQuestion >= questions.length) {
        await finishQuestionnaire(bot, userId, chatId, state);
        userQuestionnaireStates.delete(userId);
      } else {
        // Отправляем следующий вопрос
        await sendNextQuestion(bot, userId, chatId);
      }
    }

  } catch (error) {
    console.error('Error in handleQuestionnaireMessage:', error);
  }
}

// Завершение анкеты и отправка результатов
async function finishQuestionnaire(bot, userId, chatId, state) {
  try {
    // Сохраняем категорию пользователя в сессии
    await SessionManager.updateSession(userId, {
        category: state.category,
        categoryName: state.categoryName,
        questionnaire_completed: true,
        questionnaire_date: new Date().toISOString()
    });
    
    // Формируем сообщение с результатами (используем полные вопросы)
    let message = `🎉 Анкету завершено! Категорія: ${state.categoryName}\n\n`;
    message += '📋 Ваші відповіді:\n\n';

    state.answers.forEach((item, index) => {
      message += `${index + 1}. ${item.fullQuestion}\n`;
      message += `   Відповідь: ${item.answer}\n\n`;
    });

    // Подготавливаем данные для Google Sheets (только короткие названия и ответы)
    const sheetAnswers = state.answers.map(item => ({
      question: item.question,
      answer: item.answer
    }));

    // Сохраняем в Google Sheets
    const success = await saveQuestionnaireToSheet(userId, state.userData, state.category, sheetAnswers);
    
    if (!success) {
      console.error('❌ Не вдалося зберегти дані в Google Таблицю');
    }

    // Отправляем пользователю
    await bot.sendMessage(chatId, message);

    // Отправляем администраторам (если нужно)
    const admins = process.env.ADMINS.split(',').map(id => Number(id.trim()));
    for (const adminId of admins) {
      try {
        await bot.sendMessage(adminId, `📩 Нова анкета від користувача ${userId}:\n\n${message}`);
      } catch (adminError) {
        console.error('Error sending to admin:', adminError);
      }
    }

    // Отправляем кнопку "Наш HR" для перехода в личный чат
    await bot.sendMessage(chatId, 
      '🎉 Дякуємо за заповнення анкети!\n\n' +
      'Для подальшого спілкування та узгодження деталей, будь ласка, звертайтеся до нашого HR:\n\n' +
      '👤 @CleanHR',
      {
        reply_markup: {
          inline_keyboard: [
            [
              { 
                text: '💼 Написати HR', 
                url: 'https://t.me/CleanHR' 
              }
            ],
            [
              { 
                text: '🏠 Головне меню', 
                callback_data: 'main_menu' 
              }
            ]
          ]
        }
      }
    );

  } catch (error) {
    console.error('Error in finishQuestionnaire:', error);
  }
}

module.exports = {
  startQuestionnaire,
  handleQuestionnaireCallback,
  handleQuestionnaireMessage,
  userQuestionnaireStates,
  isValidPhoneNumber,
  isValidURL
};