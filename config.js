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
    
    // НАСТРОЙКИ ГЕОКОДИРОВАНИЯ (Улучшенная версия)
    GEOCODING: {
        enabled: true,
        
        // Задержки между запросами (мс)
        delays: {
            yandex: 1000,     // 1 секунда между запросами к Яндексу
            nominatim: 2000   // 2 секунды между запросами к OSM
        },
        
        // Максимальное количество одновременных запросов
        maxConcurrent: 1,
        
        // Автоматическое геокодирование при загрузке
        autoGeocode: true,
        
        // Кэширование (дней)
        cacheDays: 30,
        
        // Максимальное количество попыток
        maxRetries: 3,
        
        // Показывать приблизительные координаты до уточнения
        showApproximate: true,
        
        // Пользовательский агент для OSM
        osmUserAgent: 'TTMapApp/1.0',
        
        // Настройки прокси для Яндекса
        proxy: {
            urls: [
                'https://thingproxy.freeboard.io/fetch/',
                'https://api.corsproxy.io/?',
                'https://cors-anywhere.herokuapp.com/'
            ],
            currentIndex: 0,
            timeout: 10000 // 10 секунд таймаут
        },
        
        // Альтернативные сервисы геокодирования
        alternativeServices: {
            osmOverpass: true    // Overpass API для поиска населенных пунктов
        },
        
        // Логирование
        logging: {
            verbose: true
        }
    }
};

