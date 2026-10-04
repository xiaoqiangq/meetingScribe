// Remove source annotations only, retaining names, prose, dates and figures.
export function cleanSummaryAnnotations(content: string): string {
    const time = '\\d{1,2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?';
    const range = `${time}(?:\\s*[–—−~-]\\s*${time})?`;
    return content
        .replace(new RegExp(`[\\[（(【]\\s*${range}\\s*[\\]）)】]`, 'g'), '')
        .replace(/[（(\[【]\s*(?:topic\d+\/)?speaker[_\s]?\d+(?:\s*[,，、;；]\s*(?:topic\d+\/)?speaker[_\s]?\d+)*\s*[）)\]】]/gi, '')
        .replace(/(?:[ \t]*[（(][ \t]*|(?<![\p{L}\p{N}])[ \t]*)(?:\*\*)?来源(?:\*\*)?[ \t]*[:：](?:\*\*)?[^。\n|）)]*(?:[。）)]|$)(?:\*\*)?/gmu, '')
        .replace(/^[ \t]*[-*][ \t]*$/gm, '')
        .replace(/[ \t]+([，。；：！？、])/g, '$1')
        .replace(/[，、；]+(?=[。！？]|$)/gm, '')
        .replace(/(\S)[ \t]{2,}/g, '$1 ')
        .replace(/[ \t]+$/gm, '');
}
