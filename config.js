// Конфигурация приложения
const CONFIG = {
    // ID вашей Google Таблицы
    SPREADSHEET_ID: '1BItr9-Q8qnN0S05sMh1YLMqCCfXuNm1E88dvpGkVNU0',
    
    // Названия столбцов
    COLUMN_NAMES: {
        name: ['Название ТТ', 'Название', 'Магазин', 'Точка'],
        region: ['Регион', 'Область', 'Город'],
        address: ['Адрес', 'Местоположение'],
        status: ['Статус ТТ', 'Статус', 'Состояние'],
        manager: ['Менеджер ФИО', 'Менеджер', 'Ответственный'],
        contractor: ['Подрядчик ФИО', 'Подрядчик', 'Исполнитель']
    },
    
    // Цвета для статусов
    STATUS_COLORS: {
        'сдан': '#2ecc71',
        'Сдан': '#2ecc71',
        'Активная': '#2ecc71',
        'Отправлен ФО, не принят': '#f39c12',
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
    
    // НАСТРОЙКИ ГЕОКОДИРОВАНИЯ
    GEOCODING: {
        enabled: true,
        // Порядок геокодирования: Яндекс → Nominatim
        providers: ['yandex', 'nominatim'],
        // Кэширование (дней)
        cacheDays: 30,
        // Задержки между запросами (мс)
        delays: {
            yandex: 300,    // 300ms между запросами к Яндексу
            nominatim: 1000 // 1 секунда между запросами к OSM (требование API)
        },
        // Максимальное количество одновременных запросов
        maxConcurrent: 3,
        // Автоматическое геокодирование при загрузке
        autoGeocode: true,
        // Показывать приблизительные координаты до уточнения
        showApproximate: true,
        // Максимальное количество попыток
        maxRetries: 3
    }
};
