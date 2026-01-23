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
let autonomousGeocoder;
let geocodingQueue = [];
let isGeocoding = false;

// ========== ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ ==========
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    initAutonomousGeocoder();
    loadData();
    setupAutoUpdate();
});

// ========== ИНИЦИАЛИЗАЦИЯ АВТОНОМНОГО ГЕОКОДЕРА ==========
function initAutonomousGeocoder() {
    autonomousGeocoder = new AutonomousGeocoder();
    console.log('🚀 Автономный геокодер инициализирован');
}

// ========== ИНИЦИАЛИЗАЦИЯ КАРТЫ ==========
function initMap() {
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
            
            // Определяем цвет кластера
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
}

// ========== ЗАГРУЗКА ДАННЫХ С АВТОНОМНЫМ ГЕОКОДИРОВАНИЕМ ==========
async function loadData() {
    try {
        updateStatus('Загрузка данных...');
        showModal('Загрузка', 'Подключение к Google Таблице...');
        
        // 1. Загружаем данные
        const data = await loadDataAsCSV();
        
        if (!data || data.length === 0) {
            throw new Error('Не удалось загрузить данные');
        }
        
        // 2. Обрабатываем данные
        allPoints = processData(data);
        
        // 3. Автономное геокодирование
        updateModal('Автономное геокодирование', 
            `Обрабатываю ${allPoints.length} точек...\nИспользую локальную базу и открытые источники`);
        
        allPoints = await autonomousGeocoding(allPoints);
        
        // 4. Показываем точки на карте
        updateFilters();
        updateStatistics();
        updateLegend();
        showPointsOnMap();
        
        // 5. Скрываем модальное окно
        closeModal();
        updateStatus(`Загружено: ${allPoints.length} точек`);
        
        showNotification('Данные успешно загружены с автономным геокодированием', 'success');
        
        // 6. Запускаем фоновое улучшение координат
        setTimeout(improveGeocodingBackground, 3000);
        
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        updateStatus('Ошибка загрузки');
        showNotification('Ошибка загрузки данных. Пробуем еще раз...', 'error');
        
        // Пробуем альтернативный метод
        setTimeout(tryAlternativeLoad, 5000);
    }
}

// ========== АВТОНОМНОЕ ГЕОКОДИРОВАНИЕ ==========
async function autonomousGeocoding(points) {
    console.log(`🔄 Начинаю автономное геокодирование для ${points.length} точек`);
    
    const updatedPoints = [];
    const BATCH_SIZE = 10;
    
    for (let i = 0; i < points.length; i += BATCH_SIZE) {
        const batch = points.slice(i, i + BATCH_SIZE);
        
        // Обновляем прогресс
        if (i % 50 === 0) {
            updateModal('Автономное геокодирование',
                `Обработано ${Math.min(i + BATCH_SIZE, points.length)} из ${points.length} точек\n` +
                `Использую локальную базу, OpenStreetMap, Яндекс.Карты...`);
        }
        
        // Обрабатываем пакет параллельно
        const batchPromises = batch.map(async (point) => {
            try {
                // Если уже есть координаты - пропускаем
                if (point.lat && point.lng) {
                    return point;
                }
                
                // Геокодируем через автономный геокодер
                const result = await autonomousGeocoder.geocode(
                    point.address || '', 
                    point.region || '', 
                    point.city || ''
                );
                
                if (result) {
                    point.lat = result.lat;
                    point.lng = result.lng;
                    point.coordinates = `${result.lat},${result.lng}`;
                    point.source = result.source;
                    point.isMock = result.isApproximate || false;
                    point.geocoded = true;
                    
                    if (result.isApproximate) {
                        point.precision = 'low';
                        point.needsImprovement = true;
                    }
                } else {
                    // Если не нашли, используем региональные координаты
                    const regionalCoords = autonomousGeocoder.getRegionalCoordinates(point.region, point.city);
                    if (regionalCoords) {
                        point.lat = regionalCoords.lat;
                        point.lng = regionalCoords.lng;
                        point.coordinates = `${regionalCoords.lat},${regionalCoords.lng}`;
                        point.source = 'Regional Approximation';
                        point.isMock = true;
                        point.precision = 'very low';
                        point.needsImprovement = true;
                    }
                }
                
                return point;
            } catch (error) {
                console.warn('Ошибка геокодирования точки:', point.name, error);
                return point;
            }
        });
        
        // Ожидаем завершения пакета
        const batchResults = await Promise.allSettled(batchPromises);
        
        // Собираем результаты
        batchResults.forEach(result => {
            if (result.status === 'fulfilled') {
                updatedPoints.push(result.value);
            }
        });
        
        // Задержка между пакетами для соблюдения лимитов
        if (i + BATCH_SIZE < points.length) {
            await sleep(1000);
        }
    }
    
    console.log(`✅ Автономное геокодирование завершено: ${updatedPoints.length} точек`);
    
    // Анализируем результаты
    const geocodedCount = updatedPoints.filter(p => p.geocoded).length;
    const exactCount = updatedPoints.filter(p => p.geocoded && !p.isMock).length;
    const approximateCount = updatedPoints.filter(p => p.isMock).length;
    
    console.log(`📊 Статистика: ${geocodedCount} геокодировано, ` +
                `${exactCount} точно, ${approximateCount} приблизительно`);
    
    return updatedPoints;
}

// ========== ФОНОВОЕ УЛУЧШЕНИЕ КООРДИНАТ ==========
async function improveGeocodingBackground() {
    const pointsToImprove = allPoints.filter(p => 
        p.needsImprovement && p.address && !p.isImproving
    );
    
    if (pointsToImprove.length === 0) {
        console.log('📭 Нет точек для улучшения');
        return;
    }
    
    console.log(`🔄 Запускаю фоновое улучшение для ${pointsToImprove.length} точек`);
    
    // Ограничиваем количество для фоновой обработки
    const limitedPoints = pointsToImprove.slice(0, 50);
    
    let improvedCount = 0;
    
    for (let i = 0; i < limitedPoints.length; i++) {
        const point = limitedPoints[i];
        point.isImproving = true;
        
        try {
            // Пробуем улучшить через онлайн-геокодирование
            const result = await autonomousGeocoder.geocode(point.address, point.region);
            
            if (result && !result.isApproximate) {
                // Улучшаем точку
                point.lat = result.lat;
                point.lng = result.lng;
                point.coordinates = `${result.lat},${result.lng}`;
                point.source = result.source;
                point.isMock = false;
                point.needsImprovement = false;
                point.precision = result.precision || 'high';
                improvedCount++;
                
                // Обновляем маркер на карте
                updateMarkerOnMap(point);
                
                console.log(`✅ Улучшена точка: ${point.name}`);
            }
            
            // Задержка для соблюдения лимитов
            await sleep(2000);
            
        } catch (error) {
            console.warn(`Не удалось улучшить точку: ${point.name}`, error);
        }
        
        point.isImproving = false;
        
        // Каждые 10 точек обновляем статус
        if (i % 10 === 0) {
            updateStatus(`Фоновое улучшение: ${i}/${limitedPoints.length} (${improvedCount} улучшено)`);
        }
    }
    
    if (improvedCount > 0) {
        updateStatus(`Готово. ${improvedCount} точек улучшено`);
        showNotification(`Фоновое улучшение: ${improvedCount} точек стали точнее`, 'success');
        
        // Обновляем статистику
        updateStatistics();
    }
}

// ========== ОБНОВЛЕННАЯ ФУНКЦИЯ УЛУЧШЕНИЯ КООРДИНАТ ==========
async function improveGeocoding() {
    const pointsToImprove = allPoints.filter(p => p.isMock && p.address && !p.isImproving);
    
    if (pointsToImprove.length === 0) {
        showNotification('Нет точек с приблизительными координатами для уточнения', 'info');
        return;
    }
    
    showModal('Автономное уточнение координат', 
        `Найдено ${pointsToImprove.length} точек для уточнения.\n` +
        `Использую несколько источников для повышения точности...`);
    
    // Ограничиваем количество
    const limitedPoints = pointsToImprove.slice(0, 30);
    
    let improvedCount = 0;
    
    for (let i = 0; i < limitedPoints.length; i++) {
        const point = limitedPoints[i];
        
        updateModal('Автономное уточнение координат', 
            `Обрабатываю ${i+1} из ${limitedPoints.length}...\n` +
            `(${improvedCount} улучшено)\n` +
            `Текущая: ${point.name}`);
        
        try {
            // Используем автономный геокодер для улучшения
            const result = await autonomousGeocoder.geocode(point.address, point.region);
            
            if (result && !result.isApproximate) {
                // Улучшаем точку
                point.lat = result.lat;
                point.lng = result.lng;
                point.coordinates = `${result.lat},${result.lng}`;
                point.source = result.source;
                point.isMock = false;
                point.precision = result.precision || 'high';
                improvedCount++;
                
                // Обновляем маркер на карте
                updateMarkerOnMap(point);
                
                // Обновляем кэш
                const cacheKey = `geocode_${point.address}_${point.region}`.replace(/[^a-z0-9]/gi, '_');
                localStorage.setItem(cacheKey, JSON.stringify({
                    result: { lat: result.lat, lng: result.lng },
                    timestamp: Date.now()
                }));
            }
            
            // Задержка для API лимитов
            await sleep(1500);
            
        } catch (error) {
            console.warn('Не удалось уточнить:', point.name, error);
        }
    }
    
    closeModal();
    updateStatistics();
    
    if (improvedCount > 0) {
        showNotification(`Уточнены координаты для ${improvedCount} точек`, 'success');
    } else {
        showNotification('Не удалось улучшить координаты. Попробуйте позже.', 'info');
    }
}

// ========== ОБНОВЛЕННАЯ ФУНКЦИЯ СОЗДАНИЯ МАРКЕРА ==========
function createMarker(point) {
    // Определяем цвет по статусу
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
    
    // Определяем иконку в зависимости от точности координат
    let markerIcon = '📌';
    let badgeColor = '';
    
    if (point.isMock) {
        markerIcon = '📍';
        badgeColor = '#f39c12';
    } else if (point.precision === 'high') {
        markerIcon = '🎯';
        badgeColor = '#2ecc71';
    } else if (point.precision === 'medium') {
        markerIcon = '📍';
        badgeColor = '#3498db';
    }
    
    const icon = L.divIcon({
        html: `
            <div style="
                background: ${color};
                width: 35px;
                height: 35px;
                border-radius: 50%;
                border: 3px solid white;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                font-size: 16px;
                position: relative;
            ">
                ${markerIcon}
                ${point.isMock ? `
                    <div style="
                        position: absolute;
                        top: -5px;
                        right: -5px;
                        width: 12px;
                        height: 12px;
                        background: ${badgeColor};
                        border-radius: 50%;
                        border: 2px solid white;
                    "></div>
                ` : ''}
            </div>
        `,
        className: 'custom-marker',
        iconSize: [35, 35],
        iconAnchor: [17, 35]
    });
    
    const marker = L.marker([point.lat, point.lng], {
        icon: icon,
        title: point.name,
        status: point.status,
        precision: point.precision || 'unknown'
    });
    
    // Всплывающее окно
    marker.bindPopup(createPopupContent(point));
    
    // Клик по маркеру
    marker.on('click', function() {
        showPointDetails(point);
    });
    
    return marker;
}

// ========== ОБНОВЛЕННОЕ ВСПЛЫВАЮЩЕЕ ОКНО ==========
function createPopupContent(point) {
    const color = CONFIG.STATUS_COLORS[point.status] || 
                  (point.status && point.status.toLowerCase().includes('сдан') ? CONFIG.STATUS_COLORS['сдан'] : CONFIG.STATUS_COLORS.default);
    
    // Определяем иконку точности
    let precisionIcon = '🎯';
    let precisionText = 'Высокая';
    let precisionColor = '#2ecc71';
    
    if (point.isMock) {
        precisionIcon = '📍';
        precisionText = 'Приблизительная';
        precisionColor = '#f39c12';
    } else if (point.precision === 'medium') {
        precisionIcon = '📍';
        precisionText = 'Средняя';
        precisionColor = '#3498db';
    } else if (point.precision === 'low') {
        precisionIcon = '🌍';
        precisionText = 'Низкая';
        precisionColor = '#f39c12';
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
            
            <div style="margin-bottom: 10px; font-size: 12px;">
                <strong>Точность:</strong> 
                <span style="color: ${precisionColor}; font-weight: 500;">
                    ${precisionIcon} ${precisionText}
                </span>
                ${point.source ? `<br><small>Источник: ${point.source}</small>` : ''}
            </div>
            
            ${point.address ? `
                <div style="margin-bottom: 10px;">
                    <strong>📍 Адрес:</strong><br>
                    <span style="font-size: 14px;">${point.address}</span>
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
            
            ${point.isMock ? `
                <div style="margin-top: 10px; padding: 5px; background: #f39c12; color: white; border-radius: 3px; font-size: 11px;">
                    <i class="fas fa-exclamation-triangle"></i> Приблизительные координаты
                    <br><small>Будет уточнено в фоновом режиме</small>
                </div>
            ` : ''}
            
            ${point.lat && point.lng ? `
                <div style="margin-top: 10px; padding: 8px; background: #f8f9fa; border-radius: 4px; font-size: 11px;">
                    <strong>Координаты:</strong><br>
                    ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}
                </div>
            ` : ''}
        </div>
    `;
}

// ========== ОБНОВЛЕННАЯ СТАТИСТИКА ==========
function updateStatistics() {
    const filteredPoints = filterPoints();
    const shownPoints = filteredPoints.filter(p => p.lat && p.lng).length;
    const mockPoints = filteredPoints.filter(p => p.isMock).length;
    const exactPoints = shownPoints - mockPoints;
    
    document.getElementById('total-points').textContent = allPoints.length;
    document.getElementById('shown-points').textContent = shownPoints;
    
    // Обновляем статус с информацией о точности
    const statusEl = document.getElementById('status');
    if (statusEl) {
        if (mockPoints > 0) {
            statusEl.innerHTML = `<i class="fas fa-map-marker-alt"></i> ` +
                                `${shownPoints} показано (${exactPoints} точно, ${mockPoints} приблизительно)`;
        } else {
            statusEl.innerHTML = `<i class="fas fa-check-circle" style="color: #2ecc71;"></i> ` +
                                `Загружено: ${allPoints.length} точек`;
        }
    }
}

// ========== ОБНОВЛЕННАЯ ЛЕГЕНДА ==========
function updateLegend() {
    const container = document.getElementById('legend');
    
    let legendHTML = `
        <div style="margin-bottom: 15px;">
            <strong style="font-size: 12px; color: #666;">Точность координат:</strong>
            <div style="display: flex; align-items: center; gap: 10px; margin: 5px 0;">
                <div style="width: 15px; height: 15px; border-radius: 50%; background: #2ecc71; border: 2px solid white;"></div>
                <span style="font-size: 11px;">Высокая</span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; margin: 5px 0;">
                <div style="width: 15px; height: 15px; border-radius: 50%; background: #3498db; border: 2px solid white;"></div>
                <span style="font-size: 11px;">Средняя</span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; margin: 5px 0;">
                <div style="width: 15px; height: 15px; border-radius: 50%; background: #f39c12; border: 2px solid white;"></div>
                <span style="font-size: 11px;">Приблизительная</span>
            </div>
        </div>
        
        <div style="border-top: 1px solid #eee; padding-top: 10px;">
            <strong style="font-size: 12px; color: #666;">Статусы точек:</strong>
    `;
    
    // Собираем статусы из данных
    const statuses = new Set();
    allPoints.forEach(point => {
        if (point.status) {
            statuses.add(point.status);
        }
    });
    
    // Добавляем стандартные статусы если нужно
    if (statuses.size < 3) {
        statuses.add('сдан');
        statuses.add('Отправлен ФО, не принят');
        statuses.add('План');
    }
    
    // Создаем элементы легенды для статусов
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
            <div style="display: flex; align-items: center; gap: 10px; margin: 5px 0;">
                <div style="width: 12px; height: 12px; border-radius: 50%; background: ${color}; border: 2px solid white;"></div>
                <span style="font-size: 11px;">${status}</span>
            </div>
        `;
    });
    
    legendHTML += `</div>`;
    
    container.innerHTML = legendHTML;
}

// ========== ОБНОВЛЕННАЯ КНОПКА УТОЧНЕНИЯ ==========
function showImproveGeocodingButton() {
    const mockPointsCount = allPoints.filter(p => p.isMock).length;
    
    if (mockPointsCount > 0) {
        // Добавляем или обновляем кнопку улучшения
        let improveBtn = document.getElementById('improve-geocoding-btn');
        if (!improveBtn) {
            improveBtn = document.createElement('button');
            improveBtn.id = 'improve-geocoding-btn';
            improveBtn.className = 'btn btn-warning';
            improveBtn.innerHTML = `<i class="fas fa-bullseye"></i> Уточнить координаты (${mockPointsCount})`;
            improveBtn.onclick = improveGeocoding;
            improveBtn.style.marginTop = '10px';
            
            const controls = document.querySelector('.controls');
            if (controls) {
                controls.appendChild(improveBtn);
            }
        } else {
            improveBtn.innerHTML = `<i class="fas fa-bullseye"></i> Уточнить координаты (${mockPointsCount})`;
        }
    }
}

// ========== ОСТАЛЬНЫЕ ФУНКЦИИ (остаются без изменений) ==========

// ... (остальные функции из оригинального app.js остаются без изменений)

// ========== ЭКСПОРТ ФУНКЦИЙ С ДОБАВЛЕННОЙ ФУНКЦИЕЙ УЛУЧШЕНИЯ ==========
window.loadData = loadData;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.searchPoints = searchPoints;
window.closeModal = closeModal;
window.improveGeocoding = improveGeocoding;
