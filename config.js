// Конфигурация приложения
const CONFIG = {
    // ID вашей Google Таблицы
    SPREADSHEET_ID: '1BItr9-Q8qnN0S05sMh1YLMqCCfXuNm1E88dvpGkVNU0',
    
    // Оставьте ПУСТЫМ - используем автономный геокодер
    API_KEY: '',
    
    // Названия столбцов
    COLUMN_NAMES: {
        name: ['Название ТТ', 'Название', 'Магазин', 'Точка'],
        region: ['Регион', 'Область', 'Город'],
        city: ['Город', 'Населенный пункт'],
        address: ['Адрес', 'Местоположение', 'Адрес ТТ'],
        status: ['Статус ТТ', 'Статус', 'Состояние'],
        manager: ['Менеджер ФИО', 'Менеджер', 'Ответственный'],
        contractor: ['Подрядчик ФИО', 'Подрядчик', 'Исполнитель'],
        coordinates: ['Координаты', 'GPS', 'Широта/Долгота']
    },
    
    // Цвета для статусов
    STATUS_COLORS: {
        'сдан': '#2ecc71',           // зеленый
        'Сдан': '#2ecc71',
        'Активная': '#2ecc71',
        'Активна': '#2ecc71',
        'Отправлен ФО, не принят': '#f39c12', // оранжевый
        'На паузе': '#f39c12',
        'Пауза': '#f39c12',
        'Закрыта': '#e74c3c',        // красный
        'Закрыт': '#e74c3c',
        'План': '#3498db',           // синий
        'Плановая': '#3498db',
        'В работе': '#9b59b6',       // фиолетовый
        'default': '#95a5a6'         // серый
    },
    
    // Цвета для точности координат
    PRECISION_COLORS: {
        'high': '#2ecc71',      // высокая - зеленый
        'medium': '#3498db',    // средняя - синий
        'low': '#f39c12',       // низкая - оранжевый
        'very low': '#e74c3c',  // очень низкая - красный
        'unknown': '#95a5a6'    // неизвестно - серый
    },
    
    // Настройки автономного геокодера
    GEOCODER: {
        enabled: true,
        sources: ['local', 'nominatim', 'yandex', '2gis'],
        cacheDuration: 90, // дней
        requestDelay: 1000, // мс
        timeout: 15000, // мс
        maxBatchSize: 10,
        backgroundImprovement: true,
        improvementDelay: 2000 // мс
    },
    
    // Настройки карты
    MAP: {
        center: [55.7558, 37.6173], // Москва
        zoom: 4,
        tileLayer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18,
        minZoom: 2
    },
    
    // Настройки обновления
    UPDATE: {
        auto: true,
        interval: 300000, // 5 минут
        backgroundGeocoding: true,
        geocodingInterval: 60000 // 1 минута
    },
    
    // Настройки фильтров
    FILTERS: {
        showPrecisionFilter: true,
        defaultPrecision: 'all',
        rememberFilters: true,
        filterLifetime: 7 // дней
    },
    
    // Настройки отображения
    DISPLAY: {
        showGeocoderInfo: true,
        showStats: true,
        showLegend: true,
        clusterMarkers: true,
        clusterRadius: 40,
        markerAnimation: true
    }
};
