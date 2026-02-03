// Конфигурация приложения ADTS
const CONFIG = {
    // ID вашей Google Таблицы - ВАШ АКТУАЛЬНЫЙ ID
    SPREADSHEET_ID: 'ВАШ_ТЕКУЩИЙ_SPREADSHEET_ID',
    
    // Настройки карты
    MAP: {
        center: [55.7558, 37.6173],
        zoom: 4,
        tileLayer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
        minZoom: 2
    },
    
    // Настройки обновления
    UPDATE: {
        auto: true,
        interval: 300000, // 5 минут
        showTimer: true,
        enableNotifications: true
    },
    
    // Настройки маркеров
    MARKERS: {
        defaultSize: 34,
        hoverSize: 42,
        clusterRadius: 40,
        popupMaxWidth: 350,
        animationSpeed: 300
    },
    
    // Настройки фильтров
    FILTERS: {
        maxVisibleOptions: 100,
        rememberSelections: true,
        enableMultiSelect: true,
        autoDetectSheets: true
    },
    
    // Настройки интерфейса
    UI: {
        showAccuracyStats: true,
        showLastUpdate: true,
        enableTooltips: true,
        smoothAnimations: true,
        theme: 'dark',
        showSheetsSelector: true,
        showProjectFilter: true,
        showRegionFilter: true,
        showManagerFilter: true
    },
    
    // Настройки для работы с листами
    SHEETS: {
        enabled: true,
        autoDetect: true,
        defaultSheetName: null,
        // Листы которые нужно исключить (указывайте названия своих листов)
        excludedSheets: ['README', 'Инструкция', 'Settings', 'Шаблон', 'Template', 'Образец'],
        // Листы которые нужно обязательно включить (если знаете названия)
        includedSheets: [], // ['Москва', 'СПб', 'Регионы'] - укажите свои
        cacheSheetsInfo: true,
        cacheDuration: 300000
    },
    
    // Настройки столбцов (для разных листов могут быть разные названия)
    COLUMN_NAMES: {
        name: ['Название', 'Точка', 'ТТ', 'Магазин', 'Name', 'Point'],
        region: ['Регион', 'Область', 'Город', 'Region', 'City'],
        address: ['Адрес', 'Адрес ТТ', 'Местоположение', 'Address', 'Location'],
        status: ['Статус', 'Статус монтажа', 'Состояние', 'Status'],
        manager: ['Менеджер', 'Ответственный', 'Менеджер проекта', 'Manager'],
        contractor: ['Подрядчик', 'Исполнитель', 'Контрагент', 'Contractor'],
        project: ['Проект', 'Название проекта', 'Project']
    },
    
    // Отладка
    DEBUG: {
        logLevel: 'debug', // Измените на 'info' для меньшего количества логов
        showConsoleMessages: true,
        enablePerformanceTracking: true,
        logSheetData: true, // Логировать данные с листов
        showRawData: false  // Показывать сырые данные в консоли
    }
};

// Функция для получения настроек по ключу
function getConfig(key, defaultValue = null) {
    const keys = key.split('.');
    let value = CONFIG;
    
    for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
            value = value[k];
        } else {
            return defaultValue;
        }
    }
    
    return value !== undefined ? value : defaultValue;
}

// Функция для получения названий столбцов
function getColumnNames(type) {
    return CONFIG.COLUMN_NAMES[type] || [type];
}

// Валидация конфигурации
function validateConfig() {
    const errors = [];
    const warnings = [];
    
    if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID === 'ВАШ_ТЕКУЩИЙ_SPREADSHEET_ID') {
        errors.push('Не указан SPREADSHEET_ID. Замените "ВАШ_ТЕКУЩИЙ_SPREADSHEET_ID" на реальный ID вашей таблицы.');
    }
    
    if (!CONFIG.MAP.center || !Array.isArray(CONFIG.MAP.center) || CONFIG.MAP.center.length !== 2) {
        errors.push('Неверный формат MAP.center');
    }
    
    if (CONFIG.SHEETS.excludedSheets.length === 0) {
        warnings.push('Нет исключенных листов. Рекомендуется указать системные листы в excludedSheets.');
    }
    
    if (errors.length > 0) {
        console.error('Критические ошибки в конфигурации:', errors);
        alert('Ошибка конфигурации: ' + errors.join(', '));
        return false;
    }
    
    if (warnings.length > 0) {
        console.warn('Предупреждения конфигурации:', warnings);
    }
    
    console.log('Конфигурация загружена успешно');
    return true;
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', function() {
    if (CONFIG.DEBUG.showConsoleMessages) {
        console.group('=== КОНФИГУРАЦИЯ ADTS КАРТЫ ===');
        console.log('SPREADSHEET_ID:', CONFIG.SPREADSHEET_ID);
        console.log('Поддержка листов:', CONFIG.SHEETS.enabled);
        console.log('Исключаемые листы:', CONFIG.SHEETS.excludedSheets);
        console.log('Уровень логирования:', CONFIG.DEBUG.logLevel);
        console.groupEnd();
    }
    
    validateConfig();
});

// Экспорт
window.CONFIG = CONFIG;
window.getConfig = getConfig;
window.getColumnNames = getColumnNames;
window.validateConfig = validateConfig;
