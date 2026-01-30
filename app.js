generateOSMQueries(address, region = '') {
    const queries = new Set();
    const parts = address.split(',').map(p => p.trim()).filter(p => p.length > 1);
    
    console.log(`🔍 Части адреса:`, parts);
    
    // Удаляем "Россия" из адреса для OSM
    let addressWithoutRussia = address.replace(/,\s*Россия$/i, '').trim();
    if (addressWithoutRussia.length > 10) {
        queries.add(addressWithoutRussia);
    }
    
    // Ищем ключевые части адреса
    const regionPart = parts.find(p => 
        p.toLowerCase().includes('обл') || 
        p.toLowerCase().includes('край') || 
        p.toLowerCase().includes('респ')
    );
    
    // Улучшенное определение населенного пункта
    let settlementPart = null;
    for (const part of parts) {
        // Проверяем стандартные сокращения
        if (part.match(/^(г\.|с\.|п\.|пгт\.|рп\.|д\.)/i)) {
            settlementPart = part;
            break;
        }
        // Проверяем названия без сокращений
        if (part.length > 2 && 
            !part.includes('обл') && 
            !part.includes('край') && 
            !part.includes('ул') && 
            !part.includes('пр-кт') &&
            !part.includes('пер') &&
            !/\d/.test(part) &&
            part !== regionPart) {
            
            // Проверяем, не является ли это известным городом/селом
            const knownSettlements = ['мамонтово', 'барнаул', 'новосибирск', 'красноярск'];
            if (knownSettlements.some(s => part.toLowerCase().includes(s))) {
                settlementPart = part;
                // Если нет сокращения, добавляем его
                if (!settlementPart.match(/^(г\.|с\.|п\.)/i)) {
                    if (part.toLowerCase().includes('мамонтово')) {
                        settlementPart = 'с. ' + part;
                    } else {
                        settlementPart = 'г. ' + part;
                    }
                }
                break;
            }
        }
    }
    
    const streetPart = parts.find(p => 
        p.match(/^(ул\.|пр-кт\.|пер\.|ш\.|пр-д\.|пл\.|б-р\.)/i)
    );
    
    const housePart = parts.find(p => 
        /\d+/.test(p) && 
        !p.match(/^(г\.|с\.|ул\.|пр-кт\.|пер\.)/i) &&
        !p.toLowerCase().includes('обл') &&
        !p.toLowerCase().includes('край')
    );
    
    console.log(`🔍 Ключевые части:`, { regionPart, settlementPart, streetPart, housePart });
    
    // Собираем осмысленные комбинации
    if (settlementPart && streetPart && housePart) {
        // Населенный пункт + улица + дом (самый вероятный)
        queries.add([settlementPart, streetPart, housePart].join(', '));
        
        // Если есть регион
        if (regionPart) {
            queries.add([regionPart, settlementPart, streetPart, housePart].join(', '));
        }
    }
    
    if (settlementPart && streetPart) {
        // Населенный пункт + улица
        queries.add([settlementPart, streetPart].join(', '));
        queries.add([streetPart, settlementPart].join(', '));
        
        if (regionPart) {
            queries.add([regionPart, settlementPart, streetPart].join(', '));
        }
    }
    
    if (settlementPart && housePart) {
        // Населенный пункт + дом
        queries.add([settlementPart, housePart].join(', '));
    }
    
    if (streetPart && housePart) {
        // Улица + дом
        queries.add([streetPart, housePart].join(', '));
    }
    
    // Только населенный пункт
    if (settlementPart) {
        queries.add(settlementPart);
        
        // Населенный пункт + регион
        if (regionPart) {
            queries.add([regionPart, settlementPart].join(', '));
        }
    }
    
    // Только улица
    if (streetPart) {
        queries.add(streetPart);
    }
    
    // Если есть номер дома отдельно
    if (housePart && housePart.length > 1) {
        queries.add(housePart);
    }
    
    // Удаляем дубликаты и фильтруем
    const filteredQueries = Array.from(queries)
        .filter(q => q && q.length > 3 && q.length < 200)
        .slice(0, 8); // Ограничиваем количество запросов
    
    console.log(`🌍 Сгенерированные OSM запросы:`, filteredQueries);
    return filteredQueries;
}
