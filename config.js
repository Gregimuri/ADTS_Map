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
    
    // НАСТРОЙКИ ГЕОКОДИРОВАНИЯ (Решение 1: CORS прокси)
    GEOCODING: {
        enabled: true,
        // Алгоритм поиска: Нормализация → Яндекс (через прокси) → OpenStreetMap
        // CORS прокси для Яндекса (allorigins.win)
        
        // Задержки между запросами (мс)
        delays: {
            yandex: 800,     // 800ms между запросами к Яндексу (через прокси)
            nominatim: 1500  // 1.5 секунды между запросами к OSM
        },
        
        // Максимальное количество одновременных запросов
        maxConcurrent: 1,    // Для GitHub Pages лучше 1
        
        // Автоматическое геокодирование при загрузке
        autoGeocode: true,
        
        // Кэширование (дней)
        cacheDays: 30,
        
        // Максимальное количество попыток
        maxRetries: 2,
        
        // Показывать приблизительные координаты до уточнения
        showApproximate: true,
        
        // Пользовательский агент для OSM
        osmUserAgent: 'TTMapApp/1.0',
        
        // Настройки прокси
        proxy: {
            // Используем allorigins.win как CORS прокси
            url: 'https://api.allorigins.win/get?url=',
            // Альтернативные прокси (если allorigins не работает):
            alternatives: [
                'https://corsproxy.io/?',
                'https://api.codetabs.com/v1/proxy?quest='
            ]
        }
    }
};
