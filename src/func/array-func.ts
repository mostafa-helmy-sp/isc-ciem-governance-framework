// Helper method to build an ID array
export function buildAttributeArray(items: any[], attributeName: string, unique?: boolean): string[] {
    const array = items.map(item => item[attributeName] as string)
    if (unique) {
        return [...new Set(array)]
    } else {
        return array
    }
}

// Helper method to build an ID array
export function buildIdArray(items: any[], unique?: boolean): string[] {
    return buildAttributeArray(items, "id", unique)
}

// Merge arrays 
export function mergeArrays<Type>(items1: Type[], items2: Type[]): Type[] {
    return [...items1, ...items2]
}

// Merge arrays for unique
export function mergeArraysDeduplicateByAttribute<Type>(items1: Type[], items2: Type[], attributeName: string): Type[] {
    const uniqueArray: any[] = [...items1]
    const uniqueIds = new Set(buildIdArray(items1))
    items2.forEach(item => {
        if (!uniqueIds.has(item[attributeName as keyof Type] as string)) {
            uniqueArray.push(item)
            uniqueIds.add(item[attributeName as keyof Type] as string)
        }
    });
    return uniqueArray
}

// Merge arrays for unique
export function mergeArraysDeduplicateById<Type>(items1: Type[], items2: Type[]): Type[] {
    return mergeArraysDeduplicateByAttribute(items1, items1, "id")
}

// Search array by object attribute value
export function filterArrayByObjectStringAttribute<Type>(items: Type[], attributeName: string, attributeValue: string): Type[] {
    return items.filter(item => item[attributeName as keyof Type] == attributeValue)
}

// Search array by object attribute value
export function filterArrayByObjectBooleanAttribute<Type>(items: Type[], attributeName: string, attributeValue: boolean): Type[] {
    return items.filter(item => item[attributeName as keyof Type] == attributeValue)
}

// Search array by object attribute value
export function findArrayDifference(items1: string[], items2: string[]): string[] {
    return items1.filter(item => !items2.includes(item))
}

// Search array by object attribute value
export function findArrayMapDifference(items: string[], map: Map<string, any>): string[] {
    return items.filter(item => !map.has(item))
}

// Search array by object attribute value
export function findObjectAttribute<Type>(items: Type[], attributeName: string, attributeValues: string): Type | undefined {
    const results = filterArrayByObjectStringAttribute(items, attributeName, attributeValues)
    if (results.length > 0) {
        return results[0]
    } else {
        return
    }
}

// Search array by given filter string
export function filterArrayByFilterString<Type>(items: Type[], filter: string): Type[] {
    return items.filter(record => eval(filter))
}

// Helper method to build a query or filter from an array of values
export function buildQueryOrFilter<Type>(ids: Type[], itemPrefix: string, joiner: string, quotations: boolean, prefix?: string, suffix?: string): string {
    let query = ""
    // Add global prefix, e.g.: "@entitlements("
    if (prefix) {
        query += prefix
    }
    let count = 0
    for (const id of ids) {
        // Add joiner first unless first item, e.g.: " OR "
        if (count > 0) {
            query += joiner
        }
        // Add item prefix, e.g.: "id:"
        query += itemPrefix
        if (quotations) {
            query += `"${id}"`
        } else {
            query += id
        }
        count++
    }
    // Add global suffix, e.g.: ")"
    if (suffix) {
        query += suffix
    }
    return query
}