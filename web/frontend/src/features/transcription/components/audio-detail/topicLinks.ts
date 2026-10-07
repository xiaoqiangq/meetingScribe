export interface TopicLink { left: string; right: string; cosine: number }
export function selectTopicLinks(links: TopicLink[], personIds: Record<string, string>, minimum = 0.5, perPerson = 2) {
    const unique = new Map<string, TopicLink>();
    for (const link of links) {
        if (link.left === link.right || !Number.isFinite(link.cosine)) continue;
        const key = JSON.stringify([link.left, link.right].sort());
        if (!unique.has(key) || unique.get(key)!.cosine < link.cosine) unique.set(key, link);
    }
    const sorted = [...unique.values()].sort((a, b) => b.cosine - a.cosine || a.left.localeCompare(b.left) || a.right.localeCompare(b.right));
    const confirmed: TopicLink[] = [], recommended: TopicLink[] = [], other: TopicLink[] = [];
    const counts = new Map<string, number>();
    for (const link of sorted) {
        if (personIds[link.left] && personIds[link.left] === personIds[link.right]) { confirmed.push(link); continue; }
        if (link.cosine >= minimum && (counts.get(link.left) || 0) < perPerson && (counts.get(link.right) || 0) < perPerson) {
            recommended.push(link);
            counts.set(link.left, (counts.get(link.left) || 0) + 1);
            counts.set(link.right, (counts.get(link.right) || 0) + 1);
        } else other.push(link);
    }
    return { confirmed, recommended, other };
}
