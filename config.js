// Конфигурация приложения
const CONFIG = {
    // ID вашей Google Таблицы
    SPREADSHEET_ID: '1BItr9-Q8qnN0S05sMh1YLMqCCfXuNm1E88dvpGkVNU0',
    
    // Названия столбцов
    COLUMN_NAMES: {
        name: ['Название ТТ', 'Название'],
        region: ['Регион'],
        address: ['Адрес'],
        status: ['Статус ТТ', 'Статус'],
        manager: ['Менеджер ФИО', 'Менеджер'],
        contractor: ['Подрядчик ФИО', 'Подрядчик']
    },
    
    // Маппинг статусов
    STATUS_MAPPING: {
        'сдан': 'Активная',
        'Сдан': 'Активная',
        'Активная': 'Активная',
        'Отправлен ФО, не принят': 'На паузе',
        'На паузе': 'На паузе',
        'Закрыта': 'Закрыта',
        'План': 'План'
    },
    
    // Цвета для статусов
    STATUS_COLORS: {
        'Активная': '#2ecc71',
        'На паузе': '#f39c12',
        'Закрыта': '#e74c3c',
        'План': '#3498db',
        'default': '#95a5a6'
    },
    
    // Настройки карты
    MAP: {
        center: [55.7558, 37.6173],
        zoom: 4,
        tileLayer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap contributors'
    },
    
    // Настройки обновления
    UPDATE: {
        auto: true,
        interval: 300000
    },
    
    // НАСТРОЙКИ ГЕОКОДИРОВАНИЯ OSM
    GEOCODING: {
        enabled: true,
        
        // Безопасные задержки для соблюдения лимитов
        delays: {
            nominatim: 1500,  // Безопасная задержка для Nominatim
            overpass: 2000    // Задержка для Overpass
        },
        
        // Консервативные настройки для большого количества точек
        batchSize: 2,          // Маленькие батчи
        autoGeocode: false,    // Отключаем авто-геокодирование при загрузке
        
        // Кэширование
        cacheDays: 180,        // Долгий срок кэша
        
        // Пользовательский агент (обязательно)
        osmUserAgent: 'TTMapApp/1.0 (+https://github.com/your-repo)',
        
        // Стратегия
        strategy: 'settlement_first', // Сначала населенные пункты, потом адреса
        maxRetries: 2,
        useMultipleEndpoints: true
    }
};
