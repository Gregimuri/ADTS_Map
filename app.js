// ========== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==========
let map;
let markerCluster;
let allPoints = [];
let activeFilters = {
    projects: [],
    regions: [],
    statuses: [],
    managers: []
};

let updateInterval;
let geocodingQueue = [];
let isGeocodingActive = false;
let geocodingCache = new Map();
let markersMap = new Map();
let isLoading = false;

// ========== ОСНОВНЫЕ ФУНКЦИИ ИНИЦИАЛИЗАЦИИ ==========

// Функция инициализации при загрузке страницы
function initApp() {
    console.log('Инициализация приложения...');
    initMap();
    loadGeocodingCache();
    
    // Показываем демо-данные сразу
    showDemoData();
    
    // Загружаем реальные данные
    loadData();
    setupAutoUpdate();
    setupGeocodingWorker();
}

// ========== ИНИЦИАЛИЗАЦИЯ КАРТЫ ==========
function initMap() {
    console.log('Инициализация карты...');
    
    const mapElement = document.getElementById('map');
    if (!mapElement) {
        console.error('Элемент карты не найден!');
        showNotification('Ошибка: элемент карты не найден', 'error');
        return;
    }
    
    try {
        map = L.map('map').setView(CONFIG.MAP.center, CONFIG.MAP.zoom);
        
        L.tileLayer(CONFIG.MAP.tileLayer, {
            attribution: CONFIG.MAP.attribution,
            maxZoom: 18
        }).addTo(map);
        
        markerCluster = L.markerClusterGroup({
            maxClusterRadius: 40,
            iconCreateFunction: function(cluster) {
                const count = cluster.getChildCount();
                const markers = cluster.getAllChildMarkers();
                
                let color = CONFIG.STATUS_COLORS.default;
                const statuses = markers.map(m => m.options.status);
                
                if (statuses.includes('Закрыта') || statuses.includes('Отправлен ФО, не принят')) {
                    color = CONFIG.STATUS_COLORS['Закрыта'] || '#e74c3c';
                } else if (statuses.includes('На паузе')) {
                    color = CONFIG.STATUS_COLORS['На паузе'] || '#f39c12';
                } else if (statuses.includes('сдан') || statuses.includes('Сдан') || statuses.includes('Активная')) {
                    color = CONFIG.STATUS_COLORS['сдан'] || '#2ecc71';
                }
                
                return L.divIcon({
                    html: `<div style="background:${color}; color:white; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; border:3px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3);">${count}</div>`,
                    className: 'custom-cluster',
                    iconSize: [40, 40]
                });
            }
        }).addTo(map);
        
        console.log('Карта успешно инициализирована');
    } catch (error) {
        console.error('Ошибка инициализации карты:', error);
        showNotification('Ошибка загрузки карты', 'error');
    }
}

// ========== УТИЛИТЫ И ИНТЕРФЕЙС ==========
function updateStatus(message) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.innerHTML = `<i class="fas fa-circle" style="color: #2ecc71;"></i> ${message}`;
    }
}

function showModal(title, message) {
    const modal = document.getElementById('modal');
    const titleElement = document.getElementById('modal-title');
    const messageElement = document.getElementById('modal-message');
    
    if (modal && titleElement && messageElement) {
        titleElement.textContent = title;
        messageElement.textContent = message;
        modal.style.display = 'flex';
    }
}

function updateModal(title, message) {
    const titleElement = document.getElementById('modal-title');
    const messageElement = document.getElementById('modal-message');
    
    if (titleElement && messageElement) {
        titleElement.textContent = title;
        messageElement.textContent = message;
    }
}

function closeModal() {
    const modal = document.getElementById('modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function showNotification(message, type = 'info', duration = 5000) {
    document.querySelectorAll('.notification').forEach(el => el.remove());
    
    const notification = document.createElement('div');
    notification.className = 'notification';
    
    let icon = 'info-circle';
    if (type === 'success') icon = 'check-circle';
    else if (type === 'error') icon = 'exclamation-circle';
    else if (type === 'warning') icon = 'exclamation-triangle';
    
    notification.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: ${type === 'success' ? '#2ecc71' : 
                         type === 'error' ? '#e74c3c' : 
                         type === 'warning' ? '#f39c12' : '#3498db'};
            color: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 3000;
            display: flex;
            align-items: center;
            gap: 10px;
            animation: slideIn 0.3s ease;
            max-width: 400px;
            word-wrap: break-word;
        ">
            <i class="fas fa-${icon}"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.remove();
                }
            }, 300);
        }
    }, duration);
}

// ========== ЗАГРУЗКА ДАННЫХ ==========
async function loadData() {
    if (isLoading) {
        console.log('Загрузка уже выполняется, пропускаем...');
        return;
    }
    
    isLoading = true;
    
    try {
        updateStatus('Загрузка данных...');
        showModal('Загрузка', 'Подключение к Google Таблице...');
        
        console.log('Начинаю загрузку данных из Google Sheets...');
        const data = await loadDataAsCSV();
        
        if (!data || data.length === 0) {
            console.warn('Не удалось загрузить данные через CSV');
            throw new Error('Не удалось загрузить данные');
        }
        
        console.log(`Данные загружены: ${data.length} строк`);
        allPoints = processData(data);
        console.log(`Обработано точек: ${allPoints.length}`);
        
        allPoints = await addCoordinatesFast(allPoints);
        console.log(`Координаты добавлены: ${allPoints.length}`);
        
        updateFilters();
        updateStatistics();
        updateLegend();
        showPointsOnMap();
        
        if (CONFIG.GEOCODING?.enabled && CONFIG.GEOCODING.autoUpdate) {
            startBackgroundGeocoding();
        }
        
        closeModal();
        updateStatus(`Загружено: ${allPoints.length} точек`);
        showNotification('Данные успешно загружены', 'success');
        
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        updateStatus('Ошибка загрузки');
        showNotification('Ошибка загрузки данных. Используются демо-данные.', 'error');
        
        if (allPoints.length === 0) {
            showDemoData();
        }
        
    } finally {
        isLoading = false;
    }
}

async function loadDataAsCSV() {
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/export?format=csv&id=${CONFIG.SPREADSHEET_ID}`;
    
    console.log(`Загружаю CSV по URL: ${url}`);
    
    try {
        const response = await fetch(url);
        console.log(`Статус ответа: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const csvText = await response.text();
        console.log(`CSV загружен, размер: ${csvText.length} символов`);
        return parseCSV(csvText);
        
    } catch (error) {
        console.error('Ошибка загрузки CSV:', error);
        return null;
    }
}

function parseCSV(csvText) {
    try {
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        const result = [];
        
        for (let line of lines) {
            const row = [];
            let current = '';
            let inQuotes = false;
            let quoteChar = '';
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const nextChar = i + 1 < line.length ? line[i + 1] : '';
                
                // Начало кавычек
                if ((char === '"' || char === "'") && !inQuotes) {
                    inQuotes = true;
                    quoteChar = char;
                    continue;
                }
                
                // Конец кавычек
                if (char === quoteChar && inQuotes) {
                    // Проверяем двойные кавычки (экранирование)
                    if (nextChar === quoteChar) {
                        current += char;
                        i++; // Пропускаем следующую кавычку
                        continue;
                    }
                    inQuotes = false;
                    quoteChar = '';
                    continue;
                }
                
                // Разделитель вне кавычек
                if (char === ',' && !inQuotes) {
                    row.push(current.trim());
                    current = '';
                    continue;
                }
                
                // Добавляем символ
                current += char;
            }
            
            // Добавляем последнюю ячейку
            row.push(current.trim());
            
            // Убираем кавычки из ячеек
            const cleanedRow = row.map(cell => {
                let cleaned = cell;
                // Убираем внешние кавычки если они есть
                if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || 
                    (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
                    cleaned = cleaned.substring(1, cleaned.length - 1);
                }
                // Заменяем двойные кавычки на одинарные
                cleaned = cleaned.replace(/""/g, '"');
                return cleaned;
            });
            
            // Добавляем только если есть хоть одна непустая ячейка
            if (cleanedRow.some(cell => cell.trim() !== '')) {
                result.push(cleanedRow);
            }
        }
        
        console.log(`Парсинг CSV: ${result.length} строк, ${result[0]?.length || 0} колонок`);
        return result;
        
    } catch (error) {
        console.error('Ошибка парсинга CSV:', error);
        
        // Пробуем простой парсинг как запасной вариант
        try {
            const simpleResult = csvText.split('\n')
                .filter(line => line.trim() !== '')
                .map(line => line.split(',').map(cell => {
                    let clean = cell.trim();
                    if (clean.startsWith('"') && clean.endsWith('"')) {
                        clean = clean.substring(1, clean.length - 1);
                    }
                    return clean;
                }));
            
            console.log(`Использован простой парсинг: ${simpleResult.length} строк`);
            return simpleResult;
        } catch (e) {
            console.error('Простейший парсинг тоже не удался:', e);
            return [];
        }
    }
}

// ========== ОБРАБОТКА ДАННЫХ ==========
function processData(rows) {
    console.log('Начинаю обработку данных...');
    
    if (!rows || rows.length < 2) {
        console.warn('Мало данных для обработки');
        return [];
    }
    
    const points = [];
    const headers = rows[0].map(h => h.toString().trim());
    
    console.log('Заголовки таблицы (с индексами):');
    headers.forEach((h, i) => console.log(`  [${i}] "${h}"`));
    
    const colIndices = findColumnIndices(headers);
    
    // Проверим первые 3 строки для отладки
    console.log('\nПервые 3 строки данных для отладки:');
    for (let i = 1; i < Math.min(4, rows.length); i++) {
        console.log(`Строка ${i}:`);
        rows[i].forEach((cell, j) => {
            console.log(`  [${j}] "${cell}"`);
        });
    }
    
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        if (!row || row.length === 0) {
            continue;
        }
        
        // Создаем точку с данными из правильных колонок
        const point = {
            id: `point_${i}_${Date.now()}`,
            sheetRow: i + 1,
            name: row[colIndices.name] ? row[colIndices.name].toString().trim() : '',
            region: row[colIndices.region] ? row[colIndices.region].toString().trim() : '',
            address: row[colIndices.address] ? row[colIndices.address].toString().trim() : '',
            status: row[colIndices.status] ? row[colIndices.status].toString().trim() : '',
            manager: row[colIndices.manager] ? row[colIndices.manager].toString().trim() : '',
            contractor: row[colIndices.contractor] ? row[colIndices.contractor].toString().trim() : ''
        };
        
        // Отладочный вывод для первых точек
        if (i <= 3) {
            console.log(`\nОбработка точки ${i}:`);
            console.log('  Извлеченные данные:', {
                name: point.name,
                region: point.region,
                address: point.address?.substring(0, 50) + '...',
                status: point.status,
                manager: point.manager,
                contractor: point.contractor
            });
        }
        
        // Если название пустое, но есть адрес - создаем название из адреса
        if (!point.name || point.name.trim() === '') {
            if (point.address) {
                // Берем первую часть адреса до запятой
                const nameParts = point.address.split(',');
                point.name = nameParts[0].trim();
                if (point.name.length > 30) {
                    point.name = point.name.substring(0, 27) + '...';
                }
                console.log(`  Создано название из адреса: "${point.name}"`);
            } else if (point.region) {
                point.name = `Точка в ${point.region}`;
            } else {
                point.name = `Точка ${i}`;
            }
        }
        
        // Очищаем адрес от лишних символов
        if (point.address) {
            point.address = point.address
                .replace(/^\d{6},?\s*/, '') // Удаляем почтовый индекс в начале
                .replace(/\s+/g, ' ')       // Убираем лишние пробелы
                .trim();
        }
        
        // Проверяем, не перепутаны ли поля
        // Если в "статусе" есть слова, характерные для регионов - это ошибка
        const regionKeywords = ['обл', 'край', 'респ', 'область', 'автономный', 'округ'];
        if (point.status && regionKeywords.some(keyword => 
            point.status.toLowerCase().includes(keyword.toLowerCase()))) {
            console.log(`  ⚠️  Возможно ошибка: статус содержит название региона: "${point.status}"`);
            // Если регион пустой, а статус похож на регион - меняем местами
            if (!point.region || point.region.trim() === '') {
                console.log(`  ↻ Меняю местами: статус -> регион`);
                point.region = point.status;
                point.status = '';
            }
        }
        
        // Если статус пустой, а в адресе есть "сдан" - берем оттуда
        if (!point.status || point.status.trim() === '') {
            if (point.address && point.address.toLowerCase().includes('сдан')) {
                point.status = 'сдан';
                console.log(`  Найден статус в адресе: "${point.status}"`);
            } else if (point.region && point.region.toLowerCase().includes('сдан')) {
                point.status = 'сдан';
                console.log(`  Найден статус в регионе: "${point.status}"`);
            } else {
                point.status = 'Не указан';
            }
        }
        
        // Добавляем точку
        points.push(point);
    }
    
    console.log(`\nОбработано точек: ${points.length}`);
    
    // Покажем примеры обработанных точек
    if (points.length > 0) {
        console.log('Примеры обработанных точек:');
        points.slice(0, 3).forEach((p, idx) => {
            console.log(`  ${idx+1}. "${p.name}"`);
            console.log(`     Регион: "${p.region}"`);
            console.log(`     Адрес: "${p.address?.substring(0, 60)}..."`);
            console.log(`     Статус: "${p.status}"`);
            console.log(`     Менеджер: "${p.manager}"`);
            console.log(`     Подрядчик: "${p.contractor}"`);
        });
    }
    
    return points;
}

function findColumnIndices(headers) {
    console.log('🔍 Определяю колонки для заголовков:');
    headers.forEach((h, i) => console.log(`  [${i}] "${h}"`));
    
    const indices = {
        name: -1,
        region: -1,
        address: -1,
        status: -1,
        manager: -1,
        contractor: -1
    };
    
    // Преобразуем заголовки к нижнему регистру для сравнения
    const headersLower = headers.map(h => h.toString().toLowerCase().trim());
    
    // Шаг 1: Ищем точные совпадения с известными заголовками из вашей таблицы
    const exactMatches = {
        'название тт': 'name',
        'регион': 'region', 
        'адрес': 'address',
        'статус тт': 'status',
        'статус': 'status',
        'менеджер фио': 'manager',
        'менеджер': 'manager',
        'подрядчик фио': 'contractor',
        'подрядчик': 'contractor'
    };
    
    // Проверяем точные совпадения
    headersLower.forEach((header, index) => {
        if (exactMatches[header]) {
            const field = exactMatches[header];
            if (indices[field] === -1) {
                indices[field] = index;
                console.log(`✓ Точное совпадение: ${field} -> колонка ${index} ("${headers[index]}")`);
            }
        }
    });
    
    // Шаг 2: Ищем частичные совпадения для незаполненных полей
    const searchPatterns = {
        name: [
            { pattern: 'название', priority: 1 },
            { pattern: 'магазин', priority: 2 },
            { pattern: 'точка', priority: 3 },
            { pattern: 'тт', priority: 4 }
        ],
        region: [
            { pattern: 'регион', priority: 1 },
            { pattern: 'область', priority: 2 },
            { pattern: 'край', priority: 3 },
            { pattern: 'респ', priority: 4 },
            { pattern: 'город', priority: 5 }
        ],
        address: [
            { pattern: 'адрес', priority: 1 },
            { pattern: 'местоположение', priority: 2 },
            { pattern: 'место', priority: 3 },
            { pattern: 'локация', priority: 4 }
        ],
        status: [
            { pattern: 'статус тт', priority: 1 },
            { pattern: 'статус', priority: 2 },
            { pattern: 'состояние', priority: 3 }
        ],
        manager: [
            { pattern: 'менеджер фио', priority: 1 },
            { pattern: 'менеджер', priority: 2 },
            { pattern: 'фио менеджера', priority: 3 },
            { pattern: 'ответственный', priority: 4 }
        ],
        contractor: [
            { pattern: 'подрядчик фио', priority: 1 },
            { pattern: 'подрядчик', priority: 2 },
            { pattern: 'фио подрядчика', priority: 3 },
            { pattern: 'исполнитель', priority: 4 }
        ]
    };
    
    // Ищем частичные совпадения для незаполненных полей
    Object.keys(searchPatterns).forEach(field => {
        if (indices[field] === -1) {
            for (const search of searchPatterns[field]) {
                const foundIndex = headersLower.findIndex(h => h.includes(search.pattern));
                if (foundIndex !== -1 && !Object.values(indices).includes(foundIndex)) {
                    indices[field] = foundIndex;
                    console.log(`✓ Частичное совпадение: ${field} -> колонка ${foundIndex} ("${headers[foundIndex]}") по шаблону "${search.pattern}"`);
                    break;
                }
            }
        }
    });
    
    // Шаг 3: Если какие-то поля не найдены, используем эвристики
    
    // Для названия: первая колонка, если она не очень длинная
    if (indices.name === -1 && headers[0]) {
        if (headers[0].length < 50) {
            indices.name = 0;
            console.log(`⚠️  Название: предполагаю колонку 0 ("${headers[0]}")`);
        }
    }
    
    // Для региона: ищем колонку с короткими значениями (1-3 слова)
    if (indices.region === -1) {
        for (let i = 0; i < headers.length; i++) {
            if (headers[i] && headers[i].split(' ').length <= 3 && 
                !headers[i].toLowerCase().includes('адрес') &&
                !headers[i].toLowerCase().includes('статус') &&
                !Object.values(indices).includes(i)) {
                indices.region = i;
                console.log(`⚠️  Регион: предполагаю колонку ${i} ("${headers[i]}") - короткое значение`);
                break;
            }
        }
    }
    
    // Для адреса: ищем колонку с самым длинным заголовком или содержащую запятые в данных
    if (indices.address === -1) {
        // Пробуем колонку 2 (типичное положение адреса)
        if (headers.length > 2 && !Object.values(indices).includes(2)) {
            indices.address = 2;
            console.log(`⚠️  Адрес: предполагаю колонку 2 ("${headers[2] || 'N/A'}") - типичная позиция`);
        }
    }
    
    // Для статуса: ищем колонку с очень короткими значениями
    if (indices.status === -1) {
        // Пробуем колонку 3 (типичное положение статуса)
        if (headers.length > 3 && !Object.values(indices).includes(3)) {
            indices.status = 3;
            console.log(`⚠️  Статус: предполагаю колонку 3 ("${headers[3] || 'N/A'}") - типичная позиция`);
        }
    }
    
    // Для менеджера: ищем колонку с ФИО
    if (indices.manager === -1) {
        // Пробуем колонку 4
        if (headers.length > 4 && !Object.values(indices).includes(4)) {
            indices.manager = 4;
            console.log(`⚠️  Менеджер: предполагаю колонку 4 ("${headers[4] || 'N/A'}")`);
        }
    }
    
    // Для подрядчика: ищем последнюю заполненную колонку
    if (indices.contractor === -1) {
        // Пробуем последнюю колонку
        const lastIndex = headers.length - 1;
        if (lastIndex >= 0 && !Object.values(indices).includes(lastIndex)) {
            indices.contractor = lastIndex;
            console.log(`⚠️  Подрядчик: предполагаю последнюю колонку ${lastIndex} ("${headers[lastIndex] || 'N/A'}")`);
        }
    }
    
    // Шаг 4: Финальная проверка и корректировка
    
    // Проверяем, что все индексы уникальны
    const usedIndices = Object.values(indices).filter(i => i !== -1);
    const uniqueIndices = [...new Set(usedIndices)];
    
    if (usedIndices.length !== uniqueIndices.length) {
        console.warn('⚠️ Обнаружены дублирующиеся индексы колонок!');
        
        // Сбрасываем конфликтующие индексы
        const duplicates = usedIndices.filter((item, index) => usedIndices.indexOf(item) !== index);
        duplicates.forEach(dupIndex => {
            Object.keys(indices).forEach(key => {
                if (indices[key] === dupIndex) {
                    console.log(`  Сброс: ${key} (был индекс ${dupIndex})`);
                    indices[key] = -1;
                }
            });
        });
        
        // Заполняем сброшенные индексы по порядку
        let nextIndex = 0;
        Object.keys(indices).forEach(key => {
            if (indices[key] === -1) {
                while (Object.values(indices).includes(nextIndex)) {
                    nextIndex++;
                }
                indices[key] = nextIndex;
                console.log(`  Назначен новый индекс: ${key} -> ${nextIndex}`);
                nextIndex++;
            }
        });
    }
    
    // Проверяем, что у нас есть все необходимые колонки
    const requiredFields = ['name', 'address'];
    requiredFields.forEach(field => {
        if (indices[field] === -1) {
            console.error(`❌ Критическая ошибка: не найдена колонка для ${field}`);
        }
    });
    
    console.log('📊 Итоговые индексы колонок:');
    Object.keys(indices).forEach(key => {
        const index = indices[key];
        const header = index !== -1 && index < headers.length ? headers[index] : 'N/A';
        console.log(`  ${key}: ${index} -> "${header}"`);
    });
    
    return indices;
}
// ========== ГЕОКОДИРОВАНИЕ ==========
function loadGeocodingCache() {
    try {
        const cached = localStorage.getItem('geocoding_cache');
        if (cached) {
            const data = JSON.parse(cached);
            const cacheTime = data.timestamp || 0;
            const cacheDays = CONFIG.GEOCODING?.cacheDays || 30;
            const maxAge = cacheDays * 24 * 60 * 60 * 1000;
            
            if (Date.now() - cacheTime < maxAge) {
                geocodingCache = new Map(Object.entries(data.cache || {}));
                console.log(`Загружен кэш геокодирования: ${geocodingCache.size} записей`);
            } else {
                console.log('Кэш геокодирования устарел, очищаем...');
                localStorage.removeItem('geocoding_cache');
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки кэша геокодирования:', error);
    }
}

function saveGeocodingCache() {
    try {
        const cacheData = {
            cache: Object.fromEntries(geocodingCache),
            timestamp: Date.now()
        };
        localStorage.setItem('geocoding_cache', JSON.stringify(cacheData));
    } catch (error) {
        console.error('Ошибка сохранения кэша геокодирования:', error);
    }
}

function normalizeAddress(address, region = '') {
    if (!address) return '';
    
    let cleanAddress = address.toString().trim();
    cleanAddress = cleanAddress.replace(/^\d{6},?\s*/, '');
    cleanAddress = cleanAddress.replace(/,\s*\d{6}$/, '');
    cleanAddress = cleanAddress.replace(/\([^)]*\)/g, '');
    
    const stopWords = [
        'нас. пункт', 'торговая точка', 'торг точка', 'тт', 'магазин',
        'здание', 'помещение', 'пом.', 'владение', 'влад.', 'корп.', 'стр.'
    ];
    
    stopWords.forEach(word => {
        const regex = new RegExp(word, 'gi');
        cleanAddress = cleanAddress.replace(regex, '');
    });
    
    const replacements = {
        'республика': 'респ',
        'область': 'обл',
        'автономный округ': 'ао',
        'край': 'край',
        'город': 'г',
        'поселок': 'п',
        'село': 'с',
        'деревня': 'д',
        'улица': 'ул',
        'проспект': 'пр-кт',
        'переулок': 'пер',
        'бульвар': 'б-р',
        'шоссе': 'ш',
        'дом': 'д',
        'корпус': 'к',
        'строение': 'стр',
        'литер': 'лит'
    };
    
    Object.entries(replacements).forEach(([full, short]) => {
        const regex = new RegExp(`\\b${full}\\b`, 'gi');
        cleanAddress = cleanAddress.replace(regex, short);
    });
    
    cleanAddress = cleanAddress.replace(/\s+/g, ' ');
    cleanAddress = cleanAddress.replace(/,\s*,/g, ',');
    cleanAddress = cleanAddress.replace(/^\s+|\s+$/g, '');
    cleanAddress = cleanAddress.replace(/^,|,$/g, '');
    
    if (region && !cleanAddress.toLowerCase().includes(region.toLowerCase())) {
        cleanAddress = `${cleanAddress}, ${region}`;
    }
    
    if (!cleanAddress.toLowerCase().includes('россия')) {
        cleanAddress = `${cleanAddress}, Россия`;
    }
    
    return cleanAddress.trim();
}

function getGeocodingCacheKey(address, region = '') {
    const normalized = normalizeAddress(address, region).toLowerCase();
    return btoa(encodeURIComponent(normalized)).replace(/[^a-zA-Z0-9]/g, '');
}

function getCachedCoordinates(address, region = '') {
    if (!CONFIG.GEOCODING?.enabled) return null;
    
    const cacheKey = getGeocodingCacheKey(address, region);
    const cached = geocodingCache.get(cacheKey);
    
    if (cached) {
        const cacheDays = CONFIG.GEOCODING.cacheDays || 30;
        const maxAge = cacheDays * 24 * 60 * 60 * 1000;
        
        if (Date.now() - cached.timestamp < maxAge) {
            return {
                lat: cached.lat,
                lng: cached.lng,
                source: cached.source || 'cache',
                isExact: cached.isExact !== false
            };
        } else {
            geocodingCache.delete(cacheKey);
        }
    }
    
    return null;
}

function cacheCoordinates(address, region = '', lat, lng, source = 'unknown', isExact = true) {
    if (!CONFIG.GEOCODING?.enabled) return;
    
    const cacheKey = getGeocodingCacheKey(address, region);
    geocodingCache.set(cacheKey, {
        lat: lat,
        lng: lng,
        source: source,
        isExact: isExact,
        timestamp: Date.now(),
        address: address,
        region: region
    });
    
    if (geocodingCache.size % 5 === 0) {
        saveGeocodingCache();
    }
}

async function geocodeYandex(address, region = '') {
    if (!CONFIG.GEOCODING?.enabled) return null;
    
    try {
        const cleanAddress = normalizeAddress(address, region);
        const encodedAddress = encodeURIComponent(cleanAddress);
        const url = `https://geocode-maps.yandex.ru/1.x/?format=json&geocode=${encodedAddress}&results=1`;
        
        console.log(`Геокодирование Яндекс: ${cleanAddress.substring(0, 50)}...`);
        await new Promise(resolve => setTimeout(resolve, CONFIG.GEOCODING.delay?.yandex || 300));
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'TTMapApp/1.0',
                'Accept': 'application/json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.response && 
                data.response.GeoObjectCollection && 
                data.response.GeoObjectCollection.featureMember && 
                data.response.GeoObjectCollection.featureMember.length > 0) {
                
                const pos = data.response.GeoObjectCollection.featureMember[0]
                    .GeoObject.Point.pos.split(' ');
                
                const lon = parseFloat(pos[0]);
                const lat = parseFloat(pos[1]);
                
                console.log(`Яндекс нашел координаты: ${lat}, ${lon}`);
                return { lat, lng: lon, source: 'yandex', isExact: true };
            }
        }
    } catch (error) {
        console.warn('Ошибка геокодирования Яндекс:', error);
    }
    
    return null;
}

async function geocodeNominatim(address, region = '') {
    if (!CONFIG.GEOCODING?.enabled) return null;
    
    try {
        const cleanAddress = normalizeAddress(address, region);
        
        console.log(`Геокодирование OSM: ${cleanAddress.substring(0, 50)}...`);
        await new Promise(resolve => setTimeout(resolve, CONFIG.GEOCODING.delay?.nominatim || 1000));
        
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanAddress)}&limit=1&countrycodes=ru&accept-language=ru`;
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'TTMapApp/1.0',
                'Accept': 'application/json',
                'Referer': 'https://tt-map.local/'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lon = parseFloat(data[0].lon);
                
                console.log(`OSM нашел координаты: ${lat}, ${lon}`);
                return { lat, lng: lon, source: 'nominatim', isExact: true };
            }
        }
    } catch (error) {
        console.warn('Ошибка геокодирования Nominatim:', error);
    }
    
    return null;
}

async function geocodeAddress(address, region = '', pointId = null) {
    if (!CONFIG.GEOCODING?.enabled || !address) {
        return getRandomCoordinate(address, region);
    }
    
    const cached = getCachedCoordinates(address, region);
    if (cached) {
        console.log(`Координаты из кэша для: ${address.substring(0, 50)}...`);
        return cached;
    }
    
    let result = await geocodeYandex(address, region);
    
    if (!result) {
        result = await geocodeNominatim(address, region);
    }
    
    if (result && result.isExact) {
        cacheCoordinates(address, region, result.lat, result.lng, result.source, true);
        
        if (pointId) {
            updatePointCoordinates(pointId, result.lat, result.lng, result.source);
        }
    }
    
    if (!result) {
        result = getRandomCoordinate(address, region);
        cacheCoordinates(address, region, result.lat, result.lng, 'random', false);
    }
    
    return result;
}

function getRandomCoordinate(address, region = '') {
    const regionCoords = {
        'Москва': { lat: 55.7558, lng: 37.6173, radius: 0.1 },
        'Московская': { lat: 55.7558, lng: 37.6173, radius: 0.5 },
        'Санкт-Петербург': { lat: 59.9343, lng: 30.3351, radius: 0.1 },
        'Ленинградская': { lat: 59.9343, lng: 30.3351, radius: 0.5 },
        'Алтайский': { lat: 53.3481, lng: 83.7794, radius: 1.0 },
        'Архангельская': { lat: 64.5401, lng: 40.5433, radius: 1.0 },
        'Астраханская': { lat: 46.3497, lng: 48.0408, radius: 1.0 },
        'default': { lat: 55.7558, lng: 37.6173, radius: 2.0 }
    };
    
    let baseLat = 55.7558;
    let baseLng = 37.6173;
    let radius = 2.0;
    
    const searchText = (region || address || '').toLowerCase();
    
    for (const [key, coords] of Object.entries(regionCoords)) {
        if (searchText.includes(key.toLowerCase())) {
            baseLat = coords.lat;
            baseLng = coords.lng;
            radius = coords.radius;
            break;
        }
    }
    
    const randomLat = baseLat + (Math.random() - 0.5) * radius;
    const randomLng = baseLng + (Math.random() - 0.5) * radius * 2;
    
    return {
        lat: randomLat,
        lng: randomLng,
        source: 'random',
        isExact: false,
        isMock: true
    };
}

async function addCoordinatesFast(points) {
    console.log('Быстрое добавление координат для', points.length, 'точек...');
    
    const updatedPoints = [];
    
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        
        if (i % 20 === 0) {
            console.log(`Прогресс: ${i}/${points.length}`);
        }
        
        if (point.lat && point.lng && !point.isMock) {
            updatedPoints.push(point);
            continue;
        }
        
        if (point.address) {
            const cached = getCachedCoordinates(point.address, point.region);
            
            if (cached && cached.isExact) {
                point.lat = cached.lat;
                point.lng = cached.lng;
                point.coordinates = `${cached.lat},${cached.lng}`;
                point.geocodingSource = cached.source;
                point.isMock = false;
                point.cached = true;
                
                updatedPoints.push(point);
                continue;
            }
        }
        
        const randomCoords = getRandomCoordinate(point.address, point.region);
        point.lat = randomCoords.lat;
        point.lng = randomCoords.lng;
        point.coordinates = `${randomCoords.lat},${randomCoords.lng}`;
        point.isMock = true;
        point.geocodingSource = 'random_initial';
        
        updatedPoints.push(point);
    }
    
    return updatedPoints;
}

function updatePointCoordinates(pointId, lat, lng, source = 'unknown') {
    const pointIndex = allPoints.findIndex(p => p.id === pointId);
    if (pointIndex !== -1) {
        const oldPoint = allPoints[pointIndex];
        
        allPoints[pointIndex] = {
            ...oldPoint,
            lat: lat,
            lng: lng,
            coordinates: `${lat},${lng}`,
            geocodingSource: source,
            isMock: false,
            geocodedAt: new Date().toISOString()
        };
        
        updateMarkerOnMap(pointId, allPoints[pointIndex]);
        updateStatistics();
        
        console.log(`Обновлены координаты точки ${pointId}: ${lat}, ${lng} (источник: ${source})`);
        return true;
    }
    
    return false;
}

function updateMarkerOnMap(pointId, point) {
    markerCluster.eachLayer((layer) => {
        if (layer.options && layer.options.pointId === pointId) {
            markerCluster.removeLayer(layer);
            const newMarker = createMarker(point);
            markerCluster.addLayer(newMarker);
            markersMap.set(pointId, newMarker);
            return true;
        }
    });
}

function addToGeocodingQueue(point) {
    if (!CONFIG.GEOCODING?.enabled || !point.address || point.geocodingQueued) {
        return;
    }
    
    if (point.lat && point.lng && !point.isMock) {
        return;
    }
    
    point.geocodingQueued = true;
    
    geocodingQueue.push({
        pointId: point.id,
        address: point.address,
        region: point.region,
        timestamp: Date.now(),
        priority: point.isMock ? 1 : 0
    });
    
    console.log(`Добавлено в очередь геокодирования: ${point.address?.substring(0, 50)}...`);
}

async function processGeocodingQueue() {
    if (isGeocodingActive || geocodingQueue.length === 0) {
        return;
    }
    
    isGeocodingActive = true;
    
    try {
        geocodingQueue.sort((a, b) => b.priority - a.priority);
        const maxConcurrent = CONFIG.GEOCODING?.maxConcurrent || 3;
        const tasks = geocodingQueue.splice(0, Math.min(maxConcurrent, geocodingQueue.length));
        
        console.log(`Обрабатываю ${tasks.length} задач геокодирования...`);
        
        await Promise.allSettled(
            tasks.map(async (task) => {
                try {
                    const result = await geocodeAddress(task.address, task.region, task.pointId);
                    
                    if (result && result.isExact) {
                        console.log(`✅ Геокодирование успешно: ${task.address?.substring(0, 50)}...`);
                        showNotification(`Уточнены координаты для: ${task.address?.substring(0, 30)}...`, 'success', 3000);
                    }
                } catch (error) {
                    console.warn(`Ошибка геокодирования для ${task.pointId}:`, error);
                    
                    task.priority = -1;
                    task.retryCount = (task.retryCount || 0) + 1;
                    
                    if (task.retryCount <= 3) {
                        geocodingQueue.push(task);
                    }
                }
            })
        );
        
    } catch (error) {
        console.error('Ошибка обработки очереди геокодирования:', error);
    } finally {
        isGeocodingActive = false;
        
        if (geocodingQueue.length > 0) {
            setTimeout(() => {
                processGeocodingQueue();
            }, 2000);
        } else {
            console.log('Очередь геокодирования пуста');
            saveGeocodingCache();
        }
    }
}

function setupGeocodingWorker() {
    if (!CONFIG.GEOCODING?.enabled) return;
    
    setInterval(() => {
        if (geocodingQueue.length > 0 && !isGeocodingActive) {
            processGeocodingQueue();
        }
    }, 30000);
    
    console.log('Фоновое геокодирование активировано');
}

function startBackgroundGeocoding() {
    if (!CONFIG.GEOCODING?.enabled) return;
    
    console.log('Запуск фонового геокодирования для уточнения координат...');
    
    const pointsToGeocode = allPoints.filter(p => 
        p.address && 
        (p.isMock || !p.lat || !p.lng)
    );
    
    console.log(`Найдено ${pointsToGeocode.length} точек для уточнения координат`);
    
    pointsToGeocode.forEach(point => {
        addToGeocodingQueue(point);
    });
    
    if (pointsToGeocode.length > 0 && !isGeocodingActive) {
        setTimeout(() => {
            processGeocodingQueue();
        }, 3000);
    }
}

// ========== ОТОБРАЖЕНИЕ ТОЧЕК ==========
function showPointsOnMap() {
    console.log('Показываю точки на карте...');
    
    markerCluster.clearLayers();
    markersMap.clear();
    
    const filteredPoints = filterPoints();
    console.log(`Фильтровано точек: ${filteredPoints.length}`);
    
    filteredPoints.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
            markersMap.set(point.id, marker);
        } else {
            console.warn('Точка без координат:', point);
        }
    });
    
    if (filteredPoints.length > 0 && filteredPoints.some(p => p.lat && p.lng)) {
        const bounds = L.latLngBounds(
            filteredPoints
                .filter(p => p.lat && p.lng)
                .map(p => [p.lat, p.lng])
        );
        
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
        }
    } else {
        console.warn('Нет точек с координатами для отображения');
    }
    
    updateStatistics();
    updateGeocodingStats();
}

function createMarker(point) {
    let color = CONFIG.STATUS_COLORS.default;
    const statusLower = (point.status || '').toLowerCase();
    
    if (statusLower.includes('сдан') || statusLower.includes('актив')) {
        color = CONFIG.STATUS_COLORS['сдан'] || '#2ecc71';
    } else if (statusLower.includes('пауз') || statusLower.includes('отправлен')) {
        color = CONFIG.STATUS_COLORS['Отправлен ФО, не принят'] || '#f39c12';
    } else if (statusLower.includes('закрыт')) {
        color = CONFIG.STATUS_COLORS['Закрыта'] || '#e74c3c';
    } else if (statusLower.includes('план')) {
        color = CONFIG.STATUS_COLORS['План'] || '#3498db';
    }
    
    let accuracyIcon = '';
    if (point.isMock) {
        accuracyIcon = '<div style="position: absolute; top: -2px; right: -2px; width: 10px; height: 10px; background: #f39c12; border-radius: 50%; border: 2px solid white;"></div>';
    }
    
    const icon = L.divIcon({
        html: `
            <div style="position: relative;">
                <div style="
                    background: ${color};
                    width: 30px;
                    height: 30px;
                    border-radius: 50%;
                    border: 3px solid white;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: bold;
                    font-size: 12px;
                ">
                    ${point.name ? point.name.charAt(0).toUpperCase() : 'Т'}
                </div>
                ${accuracyIcon}
            </div>
        `,
        className: 'custom-marker',
        iconSize: [30, 30],
        iconAnchor: [15, 30]
    });
    
    const marker = L.marker([point.lat, point.lng], {
        icon: icon,
        title: point.name,
        status: point.status,
        pointId: point.id,
        isMock: point.isMock || false
    });
    
    marker.bindPopup(createPopupContent(point));
    marker.on('click', function() {
        showPointDetails(point);
    });
    
    return marker;
}

function createPopupContent(point) {
    const color = CONFIG.STATUS_COLORS[point.status] || 
                  (point.status && point.status.toLowerCase().includes('сдан') ? CONFIG.STATUS_COLORS['сдан'] : CONFIG.STATUS_COLORS.default);
    
    // Очищаем адрес для отображения
    let displayAddress = point.address || '';
    if (displayAddress) {
        displayAddress = displayAddress.replace(/^\d{6},?\s*/, '');
        displayAddress = displayAddress.replace(/"/g, '');
        displayAddress = displayAddress.trim();
    }
    
    // Информация о точности координат
    let accuracyInfo = '';
    if (point.isMock) {
        accuracyInfo = `
            <div style="margin-top: 10px; padding: 5px; background: #f39c12; color: white; border-radius: 3px; font-size: 11px; display: flex; align-items: center; gap: 5px;">
                <i class="fas fa-exclamation-triangle"></i> Приблизительные координаты
            </div>
        `;
    } else if (point.geocodingSource) {
        accuracyInfo = `
            <div style="margin-top: 10px; padding: 5px; background: #2ecc71; color: white; border-radius: 3px; font-size: 11px; display: flex; align-items: center; gap: 5px;">
                <i class="fas fa-check-circle"></i> Точные координаты (${point.geocodingSource})
            </div>
        `;
    }
    
    return `
        <div style="min-width: 250px; max-width: 300px;">
            <h4 style="margin: 0 0 10px 0; color: #2c3e50; border-bottom: 2px solid ${color}; padding-bottom: 5px;">
                ${point.name || 'Без названия'}
            </h4>
            
            <div style="margin-bottom: 10px; font-size: 12px; color: #7f8c8d;">
                <strong>Статус:</strong> 
                <span style="color: ${color}; font-weight: 500;">${point.status || 'Не указан'}</span>
            </div>
            
            ${displayAddress ? `
                <div style="margin-bottom: 10px;">
                    <strong>📍 Адрес:</strong><br>
                    <span style="font-size: 14px; word-break: break-word;">${displayAddress}</span>
                </div>
            ` : ''}
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px;">
                ${point.region ? `
                    <div>
                        <strong>Регион:</strong><br>
                        ${point.region}
                    </div>
                ` : ''}
                
                ${point.manager ? `
                    <div>
                        <strong>Менеджер:</strong><br>
                        ${point.manager}
                    </div>
                ` : ''}
                
                ${point.contractor ? `
                    <div>
                        <strong>Подрядчик:</strong><br>
                        ${point.contractor}
                    </div>
                ` : ''}
            </div>
            
            ${accuracyInfo}
            
            ${point.geocodedAt ? `
                <div style="margin-top: 10px; font-size: 10px; color: #95a5a6; text-align: right;">
                    Обновлено: ${new Date(point.geocodedAt).toLocaleString()}
                </div>
            ` : ''}
        </div>
    `;
}

// ========== ФИЛЬТРАЦИЯ ==========
function updateFilters() {
    console.log('Обновляю фильтры...');
    
    const filters = {
        projects: new Set(),
        regions: new Set(),
        statuses: new Set(),
        managers: new Set()
    };
    
    allPoints.forEach(point => {
        if (point.project) filters.projects.add(point.project);
        if (point.region) filters.regions.add(point.region);
        if (point.status) filters.statuses.add(point.status);
        if (point.manager) filters.managers.add(point.manager);
    });
    
    fillFilter('filter-project', Array.from(filters.projects).sort());
    fillFilter('filter-region', Array.from(filters.regions).sort());
    fillFilter('filter-status', Array.from(filters.statuses).sort());
    fillFilter('filter-manager', Array.from(filters.managers).sort());
}

function fillFilter(selectId, options) {
    const select = document.getElementById(selectId);
    if (!select) {
        console.error(`Select не найден: ${selectId}`);
        return;
    }
    
    const selected = Array.from(select.selectedOptions).map(opt => opt.value);
    select.innerHTML = '<option value="">Все</option>';
    
    options.forEach(option => {
        if (option && option.trim() !== '') {
            const opt = document.createElement('option');
            opt.value = option;
            opt.textContent = option;
            
            if (selected.includes(option)) {
                opt.selected = true;
            }
            
            select.appendChild(opt);
        }
    });
    
    console.log(`Заполнен фильтр ${selectId}: ${options.length} опций`);
}

function applyFilters() {
    console.log('Применяю фильтры...');
    
    activeFilters.projects = getSelectedValues('filter-project');
    activeFilters.regions = getSelectedValues('filter-region');
    activeFilters.statuses = getSelectedValues('filter-status');
    activeFilters.managers = getSelectedValues('filter-manager');
    
    console.log('Активные фильтры:', activeFilters);
    showPointsOnMap();
    showNotification('Фильтры применены', 'success');
}

function clearFilters() {
    console.log('Сбрасываю фильтры...');
    
    ['filter-project', 'filter-region', 'filter-status', 'filter-manager'].forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            select.selectedIndex = 0;
        }
    });
    
    activeFilters = {
        projects: [],
        regions: [],
        statuses: [],
        managers: []
    };
    
    showPointsOnMap();
    showNotification('Фильтры сброшены', 'success');
}

function getSelectedValues(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return [];
    
    return Array.from(select.selectedOptions)
        .map(opt => opt.value)
        .filter(val => val !== '');
}

function filterPoints() {
    const filtered = allPoints.filter(point => {
        const filters = [
            { key: 'project', value: point.project, active: activeFilters.projects },
            { key: 'region', value: point.region, active: activeFilters.regions },
            { key: 'status', value: point.status, active: activeFilters.statuses },
            { key: 'manager', value: point.manager, active: activeFilters.managers }
        ];
        
        for (const filter of filters) {
            if (filter.active.length > 0) {
                if (!filter.value || !filter.active.includes(filter.value)) {
                    return false;
                }
            }
        }
        
        return true;
    });
    
    console.log(`Фильтрация: ${allPoints.length} -> ${filtered.length} точек`);
    return filtered;
}

// ========== ПОИСК ==========
function searchPoints() {
    const searchInput = document.getElementById('search');
    if (!searchInput) return;
    
    const query = searchInput.value.trim().toLowerCase();
    
    if (!query) {
        showNotification('Введите текст для поиска', 'info');
        return;
    }
    
    console.log(`Поиск: "${query}"`);
    
    const results = allPoints.filter(point => {
        return (
            (point.name && point.name.toLowerCase().includes(query)) ||
            (point.address && point.address.toLowerCase().includes(query)) ||
            (point.region && point.region.toLowerCase().includes(query)) ||
            (point.manager && point.manager.toLowerCase().includes(query))
        );
    });
    
    console.log(`Найдено результатов: ${results.length}`);
    
    if (results.length === 0) {
        showNotification('Ничего не найдено', 'info');
        return;
    }
    
    markerCluster.clearLayers();
    
    results.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
        }
    });
    
    if (results.length > 0 && results.some(p => p.lat && p.lng)) {
        const bounds = L.latLngBounds(
            results
                .filter(p => p.lat && p.lng)
                .map(p => [p.lat, p.lng])
        );
        
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }
    
    showNotification(`Найдено ${results.length} точек`, 'success');
}

// ========== ИНФОРМАЦИЯ О ТОЧКЕ ==========
function showPointDetails(point) {
    const container = document.getElementById('point-details');
    const infoSection = document.getElementById('point-info');
    
    if (!container || !infoSection) return;
    
    // Определяем цвет статуса
    let color = CONFIG.STATUS_COLORS.default;
    const statusLower = (point.status || '').toLowerCase();
    
    if (statusLower.includes('сдан') || statusLower.includes('актив')) {
        color = CONFIG.STATUS_COLORS['сдан'] || '#2ecc71';
    } else if (statusLower.includes('пауз') || statusLower.includes('отправлен')) {
        color = CONFIG.STATUS_COLORS['Отправлен ФО, не принят'] || '#f39c12';
    } else if (statusLower.includes('закрыт')) {
        color = CONFIG.STATUS_COLORS['Закрыта'] || '#e74c3c';
    } else if (statusLower.includes('план')) {
        color = CONFIG.STATUS_COLORS['План'] || '#3498db';
    }
    
    // Очищаем адрес от лишних символов для отображения
    let displayAddress = point.address || '';
    if (displayAddress) {
        // Удаляем почтовый индекс в начале
        displayAddress = displayAddress.replace(/^\d{6},?\s*/, '');
        // Удаляем двойные кавычки
        displayAddress = displayAddress.replace(/"/g, '');
        // Удаляем лишние пробелы
        displayAddress = displayAddress.trim();
    }
    
    container.innerHTML = `
        <div style="margin-bottom: 15px;">
            <h5 style="color: white; margin-bottom: 5px;">${point.name || 'Без названия'}</h5>
            ${point.status ? `
                <span style="background: ${color}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px;">
                    ${point.status}
                </span>
            ` : ''}
        </div>
        
        <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 6px; margin-bottom: 15px;">
            ${displayAddress ? `
                <p style="margin-bottom: 8px;">
                    <strong>📍 Адрес:</strong><br>
                    <span style="font-size: 14px; word-break: break-word;">${displayAddress}</span>
                </p>
            ` : ''}
            
            ${point.lat && point.lng ? `
                <p style="margin: 0;">
                    <strong>Координаты:</strong> ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}
                </p>
            ` : ''}
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px;">
            ${point.region ? `
                <div>
                    <strong>Регион:</strong><br>
                    ${point.region}
                </div>
            ` : ''}
            
            ${point.manager ? `
                <div>
                    <strong>Менеджер:</strong><br>
                    ${point.manager}
                </div>
            ` : ''}
            
            ${point.contractor ? `
                <div>
                    <strong>Подрядчик:</strong><br>
                    ${point.contractor}
                </div>
            ` : ''}
            
            ${point.geocodingSource ? `
                <div>
                    <strong>Источник координат:</strong><br>
                    ${point.geocodingSource === 'yandex' ? 'Яндекс Карты' : 
                      point.geocodingSource === 'nominatim' ? 'OpenStreetMap' : 
                      point.geocodingSource === 'random' ? 'Приблизительные' : 
                      point.geocodingSource}
                </div>
            ` : ''}
        </div>
        
        ${point.isMock ? `
            <div style="margin-top: 15px; padding: 8px; background: #f39c12; color: white; border-radius: 6px; font-size: 12px;">
                <i class="fas fa-exclamation-triangle"></i> Приблизительные координаты
            </div>
        ` : ''}
    `;
    
    infoSection.style.display = 'block';
    infoSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
// ========== СТАТИСТИКА И ЛЕГЕНДА ==========
function updateStatistics() {
    const filteredPoints = filterPoints();
    const shownPoints = filteredPoints.filter(p => p.lat && p.lng).length;
    const exactPoints = filteredPoints.filter(p => p.lat && p.lng && !p.isMock).length;
    const approximatePoints = filteredPoints.filter(p => p.isMock).length;
    
    const totalPointsElement = document.getElementById('total-points');
    const shownPointsElement = document.getElementById('shown-points');
    const accuracyElement = document.getElementById('accuracy-stats');
    
    if (totalPointsElement) {
        totalPointsElement.textContent = allPoints.length;
    }
    
    if (shownPointsElement) {
        shownPointsElement.textContent = shownPoints;
    }
    
    if (accuracyElement) {
        accuracyElement.textContent = `${exactPoints}/${approximatePoints}`;
    }
    
    console.log(`Статистика: всего ${allPoints.length}, показано ${shownPoints}, точные ${exactPoints}, приблизительные ${approximatePoints}`);
}

function updateGeocodingStats() {
    const totalPoints = allPoints.length;
    const exactCoords = allPoints.filter(p => p.lat && p.lng && !p.isMock).length;
    const mockCoords = allPoints.filter(p => p.isMock).length;
    const noCoords = allPoints.filter(p => !p.lat || !p.lng).length;
    
    const statsElement = document.getElementById('geocoding-stats');
    if (!statsElement) return;
    
    statsElement.innerHTML = `
        <div style="margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 5px;">
            <div style="font-size: 12px; color: #95a5a6; margin-bottom: 5px;">
                <i class="fas fa-map-marker-alt"></i> Статистика координат:
            </div>
            <div style="display: flex; gap: 15px; font-size: 11px;">
                <div>
                    <span style="color: #2ecc71;">●</span> Точные: ${exactCoords}
                </div>
                <div>
                    <span style="color: #f39c12;">●</span> Приблизительные: ${mockCoords}
                </div>
                <div>
                    <span style="color: #e74c3c;">●</span> Без координат: ${noCoords}
                </div>
            </div>
        </div>
    `;
}

function updateLegend() {
    const container = document.getElementById('legend');
    if (!container) return;
    
    let legendHTML = '';
    const statuses = new Set();
    
    allPoints.forEach(point => {
        if (point.status) {
            statuses.add(point.status);
        }
    });
    
    if (statuses.size < 3) {
        statuses.add('сдан');
        statuses.add('Отправлен ФО, не принят');
        statuses.add('План');
    }
    
    Array.from(statuses).sort().forEach(status => {
        let color = CONFIG.STATUS_COLORS[status] || CONFIG.STATUS_COLORS.default;
        const statusLower = status.toLowerCase();
        
        if (statusLower.includes('сдан') || statusLower.includes('актив')) {
            color = '#2ecc71';
        } else if (statusLower.includes('пауз') || statusLower.includes('отправлен')) {
            color = '#f39c12';
        } else if (statusLower.includes('закрыт')) {
            color = '#e74c3c';
        } else if (statusLower.includes('план')) {
            color = '#3498db';
        }
        
        legendHTML += `
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                <div style="width: 15px; height: 15px; border-radius: 50%; background: ${color}; border: 2px solid white;"></div>
                <span style="font-size: 12px;">${status}</span>
            </div>
        `;
    });
    
    container.innerHTML = legendHTML;
}

// ========== АВТООБНОВЛЕНИЕ ==========
function setupAutoUpdate() {
    if (CONFIG.UPDATE?.auto) {
        updateInterval = setInterval(loadData, CONFIG.UPDATE.interval);
        console.log('Автообновление настроено: каждые', CONFIG.UPDATE.interval / 60000, 'минут');
    }
}

// ========== ДЕМО-ДАННЫЕ ==========
function showDemoData() {
    console.log('Показываем демо-данные...');
    
    allPoints = [
        {
            id: 'demo_1',
            name: 'Магнит №123',
            region: 'Москва',
            address: 'ул. Тверская, д. 1',
            status: 'сдан',
            manager: 'Иванов И.И.',
            contractor: 'Иванов И.И.',
            lat: 55.7570,
            lng: 37.6145,
            isMock: false,
            geocodingSource: 'demo'
        },
        {
            id: 'demo_2',
            name: 'Магнит №124',
            region: 'Московская обл.',
            address: 'г. Химки, ул. Ленина, 25',
            status: 'сдан',
            manager: 'Иванов И.И.',
            contractor: 'Иванов И.И.',
            lat: 55.8890,
            lng: 37.4450,
            isMock: false,
            geocodingSource: 'demo'
        },
        {
            id: 'demo_3',
            name: 'Басенджи',
            region: 'Алтайский край',
            address: 'Алтайский край, Мамонтово (с), ул. Партизанская, 158',
            status: 'сдан',
            manager: 'Казак Светлана',
            contractor: 'Дмитриев Александр',
            lat: 53.3481 + (Math.random() - 0.5) * 0.5,
            lng: 83.7794 + (Math.random() - 0.5) * 1.0,
            isMock: true,
            geocodingSource: 'random'
        }
    ];
    
    updateFilters();
    updateStatistics();
    updateLegend();
    updateGeocodingStats();
    showPointsOnMap();
    
    updateStatus('Демо-данные загружены');
    showNotification('Используются демо-данные. Проверьте доступ к таблице.', 'warning');
}

// ========== УПРАВЛЕНИЕ ГЕОКОДИРОВАНИЕМ ==========
function startManualGeocoding() {
    if (!CONFIG.GEOCODING?.enabled) {
        showNotification('Геокодирование отключено в настройках', 'warning');
        return;
    }
    
    const filteredPoints = filterPoints();
    const pointsToGeocode = filteredPoints.filter(p => 
        p.address && (p.isMock || !p.lat || !p.lng)
    );
    
    if (pointsToGeocode.length === 0) {
        showNotification('Нет точек для уточнения координат', 'info');
        return;
    }
    
    showNotification(`Начинаю уточнение координат для ${pointsToGeocode.length} точек...`, 'info');
    
    pointsToGeocode.forEach(point => {
        addToGeocodingQueue(point);
    });
    
    if (!isGeocodingActive) {
        processGeocodingQueue();
    }
}

function clearGeocodingCache() {
    if (confirm('Очистить кэш геокодирования? Все сохраненные координаты будут удалены.')) {
        geocodingCache.clear();
        localStorage.removeItem('geocoding_cache');
        showNotification('Кэш геокодирования очищен', 'success');
        
        setTimeout(() => {
            loadData();
        }, 1000);
    }
}

function showGeocodingStats() {
    const totalInCache = geocodingCache.size;
    const exactInCache = Array.from(geocodingCache.values()).filter(c => c.isExact).length;
    const approximateInCache = Array.from(geocodingCache.values()).filter(c => !c.isExact).length;
    
    const message = `
        <div style="text-align: left;">
            <h4>📊 Статистика геокодирования</h4>
            <p><strong>Кэш координат:</strong> ${totalInCache} записей</p>
            <p><strong>Точные координаты:</strong> ${exactInCache}</p>
            <p><strong>Приблизительные:</strong> ${approximateInCache}</p>
            <p><strong>В очереди:</strong> ${geocodingQueue.length} задач</p>
            <hr>
            <p><small>Кэш хранится ${CONFIG.GEOCODING?.cacheDays || 30} дней</small></p>
        </div>
    `;
    
    showModal('Статистика геокодирования', message);
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM загружен, запускаю приложение...');
    initApp();
});

// ========== ЭКСПОРТ ФУНКЦИЙ ==========
// Экспортируем все функции в глобальную область видимости
window.loadData = loadData;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.searchPoints = searchPoints;
window.closeModal = closeModal;
window.startManualGeocoding = startManualGeocoding;
window.clearGeocodingCache = clearGeocodingCache;
window.showGeocodingStats = showGeocodingStats;



