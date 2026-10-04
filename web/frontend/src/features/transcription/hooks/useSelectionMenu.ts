import { useState, useEffect, useCallback } from 'react';
import { resolveSelectionTime, type SelectionWordOffset } from './selectionTime';

export interface SelectionMenuState {
    visible: boolean;
    x: number;
    y: number;
    startTime: number;
    endTime: number;
    startIdx: number;
    endIdx: number;
    selectedText: string;
}

export function useSelectionMenu(
    containerRef: React.RefObject<HTMLElement | null>,
) {
    const [menuState, setMenuState] = useState<SelectionMenuState | null>(null);
    const [showEditor, setShowEditor] = useState(false);

    // Dismiss the menu programmatically
    const dismissMenu = useCallback(() => {
        setMenuState(null);
    }, []);

    // Open the note editor
    const openEditor = useCallback(() => {
        setShowEditor(true);
        // Keep menu state for quote/time data but hide the menu visually
    }, []);

    // Close the note editor
    const closeEditor = useCallback(() => {
        setShowEditor(false);
        setMenuState(null);
        window.getSelection()?.removeAllRanges();
    }, []);

    useEffect(() => {
        const handleSelectionChange = () => {
            // Don't update menu state while editor is open
            if (showEditor) return;

            const selection = window.getSelection();

            // 1. Validation: Ensure selection exists and is inside our container
            if (
                !selection ||
                selection.isCollapsed ||
                !containerRef.current ||
                !containerRef.current.contains(selection.anchorNode)
            ) {
                setMenuState(null);
                return;
            }

            // 2. Geometry: Get screen coordinates
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();

            // Each displayed paragraph has its own text and word-time map.
            // Counting all text nodes in the transcript also counts timestamps,
            // speaker names and reflowed text, which used to seek to later audio.
            const textElement = (node: Node) => (node.nodeType === Node.ELEMENT_NODE
                ? node as Element : node.parentElement)?.closest<HTMLElement>('[data-selection-map]');
            const startElement = textElement(range.startContainer);
            const endElement = textElement(range.endContainer);
            if (!startElement || !endElement ||
                !containerRef.current.contains(startElement) || !containerRef.current.contains(endElement)) {
                setMenuState(null);
                return;
            }
            const localChar = (element: HTMLElement, node: Node, offset: number) => {
                const preceding = document.createRange();
                preceding.selectNodeContents(element);
                preceding.setEnd(node, offset);
                return preceding.toString().length;
            };
            let startWords: SelectionWordOffset[];
            let endWords: SelectionWordOffset[];
            try {
                startWords = JSON.parse(startElement.dataset.selectionMap || '[]');
                endWords = startElement === endElement ? startWords : JSON.parse(endElement.dataset.selectionMap || '[]');
            } catch {
                setMenuState(null);
                return;
            }
            const startChar = localChar(startElement, range.startContainer, range.startOffset);
            const endChar = localChar(endElement, range.endContainer, range.endOffset);
            const startMatch = resolveSelectionTime(startWords, startChar,
                startElement === endElement ? endChar : startElement.textContent?.length || 0);
            const endMatch = startElement === endElement ? startMatch
                : resolveSelectionTime(endWords, 0, endChar);
            if (startMatch && endMatch) {
                // Clamp X position to stay within viewport bounds
                const centerX = rect.left + (rect.width / 2);
                const clampedX = Math.min(window.innerWidth - 16, Math.max(16, centerX));

                // Position above selection, but flip below if too close to top
                let posY = rect.top - 12;
                if (posY < 60) {
                    posY = rect.bottom + 12;
                }

                setMenuState({
                    visible: true,
                    x: clampedX,
                    y: posY,
                    startTime: startMatch.startTime,
                    endTime: endMatch.endTime,
                    startIdx: startMatch.startIdx,
                    endIdx: endMatch.endIdx,
                    selectedText: selection.toString().trim()
                });
            } else {
                setMenuState(null);
            }
        };

        // Debounce: Wait 150ms for the user to stop dragging handles
        let timeout: number;
        const onSelectionChange = () => {
            clearTimeout(timeout);
            timeout = window.setTimeout(handleSelectionChange, 150);
        };

        document.addEventListener('selectionchange', onSelectionChange);

        // UX: Hide menu immediately on scroll to mimic native behavior
        const onScroll = () => {
            if (!showEditor) {
                setMenuState(null);
            }
        };
        window.addEventListener('scroll', onScroll, true);

        return () => {
            document.removeEventListener('selectionchange', onSelectionChange);
            window.removeEventListener('scroll', onScroll, true);
            clearTimeout(timeout);
        };
    }, [containerRef, showEditor]);

    return {
        menuState,
        showEditor,
        openEditor,
        closeEditor,
        dismissMenu
    };
}
