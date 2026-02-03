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
        autoDetectSheets: true // Автоматически определять листы
    },
    
    // Настройки интерфейса
    UI: {
        showAccuracyStats: true,
        showLastUpdate: true,
        enableTooltips: true,
        smoothAnimations: true,
        theme: 'dark',
        showSheetsSelector: true // Показывать селектор листов
    },
    
    // Настройки экспорта
    EXPORT: {
        enableCSV: true,
        enableJSON: false,
        maxPointsPerExport: 10000
    },
    
    // Настройки для работы с несколькими листами
    SHEETS: {
        enabled: true, // Включить поддержку нескольких листов
        autoDetect: true, // Автоматически определять листы
        defaultSheetName: null, // Имя листа по умолчанию (null = все листы)
        excludedSheets: ['README', 'Инструкция', 'Settings'], // Листы для исключения
        cacheSheetsInfo: true, // Кэшировать информацию о листах
        cacheDuration: 300000 // 5 минут
    },
    
    // Отладка
    DEBUG: {
        logLevel: 'info', // 'debug', 'info', 'warn', 'error'
        showConsoleMessages: true,
        enablePerformanceTracking: true
    }
};

// Проверка конфигурации
function validateConfig() {
    const errors = [];
    
    if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID.length < 10) {
        errors.push('Неверный SPREADSHEET_ID');
    }
    
    if (!CONFIG.MAP.center || !Array.isArray(CONFIG.MAP.center) || CONFIG.MAP.center.length !== 2) {
        errors.push('Неверный формат MAP.center');
    }
    
    if (CONFIG.UPDATE.interval < 60000) {
        console.warn('Интервал обновления слишком мал (рекомендуется не менее 60000 мс)');
    }
    
    if (errors.length > 0) {
        console.error('Ошибки в конфигурации:', errors);
        return false;
    }
    
    console.log('Конфигурация загружена успешно');
    return true;
}

// Функция для получения настроек по ключу с значением по умолчанию
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

// Инициализация конфигурации при загрузке
document.addEventListener('DOMContentLoaded', function() {
    if (CONFIG.DEBUG.showConsoleMessages) {
        console.group('Конфигурация ADTS Карты');
        console.log('SPREADSHEET_ID:', CONFIG.SPREADSHEET_ID);
        console.log('Центр карты:', CONFIG.MAP.center);
        console.log('Автообновление:', CONFIG.UPDATE.auto ? `Каждые ${CONFIG.UPDATE.interval/1000} сек` : 'Отключено');
        console.log('Поддержка листов:', CONFIG.SHEETS.enabled ? 'Включена' : 'Выключена');
        console.log('Уровень логирования:', CONFIG.DEBUG.logLevel);
        console.groupEnd();
    }
    
    validateConfig();
});

// Экспорт функций
window.CONFIG = CONFIG;
window.getConfig = getConfig;
window.validateConfig = validateConfig;

