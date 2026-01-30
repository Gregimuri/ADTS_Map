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
    
    // Маппинг статусов для группировки
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
        'сдан': '#2ecc71',
        'Сдан': '#2ecc71',
        'На паузе': '#f39c12',
        'Отправлен ФО, не принят': '#f39c12',
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
        interval: 300000 // 5 минут
    },
    
    // НАСТРОЙКИ ГЕОКОДИРОВАНИЯ OSM (Оптимизировано)
    GEOCODING: {
        enabled: true,
        
        // Задержки между запросами (мс) - соблюдаем лимиты OSM
        delays: {
            nominatim: 1200,  // 1.2 секунды между запросами (1 запрос/сек)
            overpass: 2000    // 2 секунды для Overpass
        },
        
        // Батчинг для ускорения
        batchSize: 3,
        
        // Автоматическое геокодирование при загрузке
        autoGeocode: true,
        
        // Кэширование (дней)
        cacheDays: 90,  // Увеличили срок кэша
        
        // Максимальное количество попыток
        maxRetries: 2,
        
        // Пользовательский агент для OSM (обязательно для соблюдения правил)
        osmUserAgent: 'TTMapApp/1.0 (trade-points-map; contact@example.com)',
        
        // Настройки оптимизации для OSM
        osmOptimization: {
            normalizeAddresses: true,
            useMultipleQueries: true,
            queryLimit: 5,           // Максимум 5 запросов на адрес
            settlementCache: true,   // Кэш населенных пунктов
            retryFailed: true        // Повторная попытка для неудачных
        },
        
        // Логирование
        logging: {
            verbose: false,          // Уменьшили лог для скорости
            showQueries: false,
            showResults: true
        }
    }
};
