// Конфигурация приложения ADTS
const CONFIG = {
    // ID вашей Google Таблицы
    SPREADSHEET_ID: '1BItr9-Q8qnN0S05sMh1YLMqCCfXuNm1E88dvpGkVNU0',
    
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
        interval: 300000,
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
        showSheetsSelector: true
    },
    
    // Настройки для работы с листами
    SHEETS: {
        enabled: true,
        autoDetect: true,
        defaultSheetName: null,
        excludedSheets: ['README', 'Инструкция', 'Settings', 'Шаблон', 'Template', 'Образец'],
        includedSheets: [],
        cacheSheetsInfo: true,
        cacheDuration: 300000
    },
    
    // Настройки столбцов
    COLUMN_NAMES: {
        name: ['Название', 'ТТ', 'Магазин', 'Точка', 'Name', 'Название ТТ'],
        region: ['Регион', 'Область', 'Город', 'Region', 'City'],
        address: ['Адрес', 'Адрес ТТ', 'Местоположение', 'Address'],
        status: ['Статус', 'Статус ТТ', 'Статус монтажа', 'Status'],
        manager: ['Менеджер', 'Менеджер ФИО', 'Ответственный', 'Manager'],
        contractor: ['Подрядчик', 'Подрядчик ФИО', 'Исполнитель', 'Contractor'],
        project: ['Проект', 'Название проекта', 'Project']
    },
    
    // Отладка
    DEBUG: {
        logLevel: 'debug',
        showConsoleMessages: true,
        enablePerformanceTracking: true
    }
};

// Функции для работы с конфигурацией
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

function getColumnNames(type) {
    return CONFIG.COLUMN_NAMES[type] || [type];
}

function validateConfig() {
    const errors = [];
    const warnings = [];
    
    if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID.length < 10) {
        errors.push('Неверный SPREADSHEET_ID');
    }
    
    if (!CONFIG.MAP.center || !Array.isArray(CONFIG.MAP.center) || CONFIG.MAP.center.length !== 2) {
        errors.push('Неверный формат MAP.center');
    }
    
    if (errors.length > 0) {
        console.error('Ошибки в конфигурации:', errors);
        return false;
    }
    
    if (warnings.length > 0) {
        console.warn('Предупреждения конфигурации:', warnings);
    }
    
    return true;
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', function() {
    if (CONFIG.DEBUG.showConsoleMessages) {
        console.group('Конфигурация ADTS Карты');
        console.log('SPREADSHEET_ID:', CONFIG.SPREADSHEET_ID);
        console.log('Поддержка листов:', CONFIG.SHEETS.enabled);
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
