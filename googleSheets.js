const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const credentialsPath = path.join(__dirname, 'credentials.json');

// Структура заголовков для каждого листа
const sheetHeaders = {
  'Водії': ['Дата', 'ID', 'Username', 'Особисті дані', 'Посвідчення B', 'Стаж', 'Досвід', 'Nissan', 'Графік', 'Стажування', 'Телефон', 'Дата стажування'],
  'Клінери': ['Дата', 'ID', 'Username', 'Особисті дані', 'Досвід', 'Хімія', 'Графік', 'Фізична', 'Їздити', 'Стажування', 'Телефон', 'Дата стажування'],
  'HR': ['Дата', 'ID', 'Username', 'Особисті дані', 'Досвід HR', 'Платформи', 'Масовий підбір', 'Формат', 'Випробувальний', 'Телефон', 'Дата стажування'],
  'Менеджери': ['Дата', 'ID', 'Username', 'Особисті дані', 'Керування', 'Досвід клінінгу', 'Контроль якості', 'Організація', 'Графік', 'Продажі', 'Стажування', 'Телефон', 'Дата стажування'],
  'SMM': ['Дата', 'ID', 'Username', 'Особисті дані', 'Досвід SMM', 'Платформи', 'Контент', 'Інструменти', 'Таргет', 'Зйомка', 'Тестове', 'Портфоліо', 'Телефон', 'Дата стажування'],
  'Комірники': ['Дата', 'ID', 'Username', 'Особисті дані', 'Досвід складу', 'Інвентаризація', 'Облік матеріалів', 'Excel', 'Фізична', 'Графік 7-11', 'Локація', 'Випробувальний', 'Телефон', 'Дата стажування'],
  'Працівники ТРЦ': ['Дата', 'ID', 'Username', 'Особисті дані', 'Досвід', 'Види робіт', 'Команда', 'Фізична', 'Графік', 'Локація', 'Стажування', 'Телефон', 'Дата стажування']
};

async function saveQuestionnaireToSheet(userId, userData, category, answers) {
  try {
    // Логируем данные
    console.log('📊 Анкета:', category);
    console.log('User ID:', userId);
    console.log('Username:', userData.username || 'Не вказано');
    console.log('Answers:', answers);

    // Проверяем наличие credentials и GOOGLE_SHEET_ID
    if (!fs.existsSync(credentialsPath)) {
      console.log('❌ Файл credentials.json не знайдено');
      return true; // Продолжаем работу, но не сохраняем в таблицу
    }

    if (!process.env.GOOGLE_SHEET_ID) {
      console.log('❌ GOOGLE_SHEET_ID не встановлено в .env');
      return true; // Продолжаем работу, но не сохраняем в таблицу
    }

    // Загружаем credentials
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetName = getSheetNameForCategory(category);

    console.log('📋 Лист для сохранения:', sheetName);

    // Проверяем существование листа и создаем если нужно
    await ensureSheetExists(sheets, sheetName);

    // Получаем следующую строку
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheetName}!A:A`,
    });

    const nextRow = response.data.values ? response.data.values.length + 1 : 1;

    // Формируем данные для записи
    const rowData = [
      new Date().toLocaleString('uk-UA'),
      userId.toString(),
      userData.username || `user_${userId}`,
      ...answers.map(a => a.answer)
    ];

    console.log('📝 Дані для запису:', rowData);

    // Записываем данные
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheetName}!A${nextRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [rowData] },
    });

    console.log(`✅ Дані збережено в: ${sheetName}, рядок ${nextRow}`);
    return true;

  } catch (error) {
    console.error('❌ Помилка Google Sheets:', error.message);
    console.error('Stack:', error.stack);
    return true; // Всегда возвращаем true чтобы не прерывать процесс анкеты
  }
}

// Функция для создания листа если он не существует
async function ensureSheetExists(sheets, sheetName) {
  try {
    // Пробуем прочитать данные листа
    await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheetName}!A1:A1`,
    });
    
    console.log(`✅ Лист ${sheetName} вже існує`);
  } catch (error) {
    // Лист не существует, создаем его
    console.log(`📝 Створюємо лист: ${sheetName}`);
    
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      resource: {
        requests: [{
          addSheet: {
            properties: {
              title: sheetName
            }
          }
        }]
      }
    });

    // Добавляем заголовки
    const headers = sheetHeaders[sheetName];
    if (headers) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${sheetName}!A1:Z1`,
        valueInputOption: 'RAW',
        resource: { values: [headers] },
      });
      console.log(`✅ Заголовки створені для: ${sheetName}`);
    }
  }
}

function getSheetNameForCategory(category) {
  const sheetMap = {
    'driver': 'Водії',
    'cleaner': 'Клінери',
    'hr': 'HR',
    'manager': 'Менеджери',
    'smm': 'SMM',
    'storekeeper': 'Комірники',
    'mall_worker': 'Працівники ТРЦ'
  };
  
  return sheetMap[category] || 'Інші';
}

// Функция для проверки подключения к Google Sheets
async function checkGoogleSheets() {
  try {
    if (!fs.existsSync(credentialsPath)) {
      console.log('❌ Файл credentials.json не знайдено');
      return false;
    }

    if (!process.env.GOOGLE_SHEET_ID) {
      console.log('❌ GOOGLE_SHEET_ID не встановлено в .env');
      return false;
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    // Пробуем прочитать информацию о таблице
    const response = await sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
    });

    console.log('✅ Підключення до Google Sheets успішне');
    console.log(`📊 Назва таблиці: ${response.data.properties.title}`);
    return true;

  } catch (error) {
    console.error('❌ Помилка підключення до Google Sheets:', error.message);
    return false;
  }
}

module.exports = {
  saveQuestionnaireToSheet,
  getSheetNameForCategory,
  checkGoogleSheets
};