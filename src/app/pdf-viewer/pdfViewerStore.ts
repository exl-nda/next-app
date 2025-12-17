import { makeAutoObservable } from "mobx";
import * as pdfjsLib from "pdfjs-dist";

type MatchRange = { start: number; end: number };
type ItemRange = { start: number; end: number };
type TextItem = { str?: string };

export type OverlappingMatch = {
    matchStart: number;
    matchEnd: number;
    localStart: number;
    localEnd: number;
    globalIndex: number;
};

// Constants
const SEARCH_DEBOUNCE_MS = 300;
const PAGE_PROCESSING_BATCH_SIZE = 5;
const SCROLL_INITIAL_DELAY_MS = 100;
const SCROLL_RETRY_DELAY_MS = 200;

const escapeRegex = (value: string) => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

export class PdfViewerStore {
    isLoading = false;
    error: string | null = null;
    fileData: string | null = null;
    totalDocumentPages: number | null = null;
    currentPage = 1;
    scale = 1.0;

    searchTerm = "";
    submittedSearchTerm = "";
    pageMatches: Record<number, number> = {};
    pageTexts: Record<number, string[]> = {};
    pageJoinedTexts: Record<number, string> = {};
    pageMatchRanges: Record<number, MatchRange[]> = {};
    pageTextItemRanges: Record<number, ItemRange[]> = {};
    currentMatchIndex: number | null = null;
    isProcessingAllPages = false;

    private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private hasProcessedAllPagesForCurrentSearch = false;

    constructor() {
        makeAutoObservable(this);
    }

    get pageNumbersOptions() {
        const total = this.totalDocumentPages ?? 0;
        if (total <= 0) return [];

        return Array.from({ length: total }, (_, i) => {
            const num = i + 1;
            const str = num.toString();
            return { id: str, value: str, label: str };
        });
    }

    get totalMatches(): number {
        return Object.values(this.pageMatches).reduce((sum, v) => sum + v, 0);
    }

    setIsLoading = (value: boolean) => {
        this.isLoading = value;
    };

    setFileData = (value: string | null) => {
        this.fileData = value;
    };

    setError = (message: string | null) => {
        this.error = message;
    };

    setTotalDocumentPages = (totalPages: number) => {
        this.totalDocumentPages = totalPages;
    };

    setCurrentPage = (page: number) => {
        this.currentPage = page;
    };
    setScale = (scale: number) => {
        this.scale = scale;
    };

    setSubmittedSearchTerm = (value: string) => {
        this.submittedSearchTerm = value;
    };

    setPageMatches = (value: Record<number, number>) => {
        this.pageMatches = value;
    };

    setPageTexts = (value: Record<number, string[]>) => {
        this.pageTexts = value;
    };

    setPageJoinedTexts = (value: Record<number, string>) => {
        this.pageJoinedTexts = value;
    };

    setPageMatchRanges = (value: Record<number, MatchRange[]>) => {
        this.pageMatchRanges = value;
    };

    setPageTextItemRanges = (value: Record<number, ItemRange[]>) => {
        this.pageTextItemRanges = value;
    };

    setCurrentMatchIndex = (value: number | null) => {
        this.currentMatchIndex = value;
    };

    fetchPdf = async (finalUrl: string) => {
        try {
            this.setIsLoading(true);
            this.setError(null);

            // Use API route to proxy the request and avoid CORS issues
            const proxyUrl = `/api/pdf-proxy?url=${encodeURIComponent(finalUrl)}`;
            const response = await fetch(proxyUrl);
            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                const errorMessage = errorData?.error || `Failed to download PDF (status ${response.status})`;
                throw new Error(errorMessage);
            }

            const blob = await response.blob();
            const reader = new FileReader();

            reader.onloadend = () => {
                const result = reader.result;
                if (typeof result === "string") {
                    this.setFileData(result);
                } else {
                    this.setError("Unable to read PDF file.");
                }
                this.setIsLoading(false);
            };

            reader.onerror = () => {
                this.setIsLoading(false);
                this.setError("Error reading PDF file.");
            };

            reader.readAsDataURL(blob);
        } catch (err) {
            console.error(err);
            this.setIsLoading(false);
            this.setError(
                err instanceof Error ? err.message : "Unknown error downloading PDF.",
            );
        }
    };

    handleDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
        this.setTotalDocumentPages(numPages);
        this.resetSearchState();
    };

    private resetSearchState = () => {
        this.setPageMatches({});
        this.setPageTexts({});
        this.setPageJoinedTexts({});
        this.setPageMatchRanges({});
        this.setPageTextItemRanges({});
        this.setCurrentMatchIndex(null);
    };

    handlePageTextSuccess = (pageNumber: number, items: unknown) => {
        const rawItems = Array.isArray(items) ? items : (items as { items?: unknown[] })?.items;

        if (!Array.isArray(rawItems)) {
            console.warn("Unexpected onGetTextSuccess payload", items);
            return;
        }

        const processedText = this.processTextItems(rawItems as TextItem[]);
        this.updatePageTextData(pageNumber, processedText);

        // Only recompute if we're not processing all pages in background
        if (!this.isProcessingAllPages) {
            this.recomputeMatches();
        }
    };

    /**
     * Processes text items from PDF and returns structured text data
     */
    private processTextItems = (items: TextItem[]): {
        textArray: string[];
        joinedText: string;
        itemRanges: ItemRange[];
    } => {
        const textArray = items.map((item) => item.str ?? "");
        const itemRanges: ItemRange[] = [];
        let currentPos = 0;
        const joinedParts: string[] = [];

        textArray.forEach((text, idx) => {
            const start = currentPos;
            joinedParts.push(text);
            currentPos += text.length;
            const end = currentPos;
            itemRanges.push({ start, end });
            if (idx < textArray.length - 1) {
                currentPos += 1; // space separator
            }
        });

        return {
            textArray,
            joinedText: joinedParts.join(" "),
            itemRanges,
        };
    };

    /**
     * Updates store with processed text data for a specific page
     */
    private updatePageTextData = (
        pageNumber: number,
        { textArray, joinedText, itemRanges }: { textArray: string[]; joinedText: string; itemRanges: ItemRange[] }
    ) => {
        this.setPageTexts({
            ...this.pageTexts,
            [pageNumber]: textArray,
        });

        this.setPageJoinedTexts({
            ...this.pageJoinedTexts,
            [pageNumber]: joinedText,
        });

        this.setPageTextItemRanges({
            ...this.pageTextItemRanges,
            [pageNumber]: itemRanges,
        });
    };

    private recomputeMatches = () => {
        const term = this.submittedSearchTerm.trim();
        if (!term) {
            this.setPageMatches({});
            this.setPageMatchRanges({});
            this.setCurrentMatchIndex(null);
            return;
        }

        const parts = term.split(/\s+/).filter((p) => p.length > 0);
        const escapedParts = parts.map((part) => escapeRegex(part));
        const regexPattern = escapedParts.join("\\s+");
        const newMatches: Record<number, number> = {};
        const newMatchRanges: Record<number, MatchRange[]> = {};

        Object.entries(this.pageJoinedTexts).forEach(([pageKey, joinedText]) => {
            const pageNumber = Number(pageKey);
            const matches: MatchRange[] = [];
            let match;
            const regexWithGlobal = new RegExp(regexPattern, "gi");
            while ((match = regexWithGlobal.exec(joinedText)) !== null) {
                matches.push({
                    start: match.index,
                    end: match.index + match[0].length,
                });
            }
            newMatches[pageNumber] = matches.length;
            newMatchRanges[pageNumber] = matches;
        });

        this.setPageMatches(newMatches);
        this.setPageMatchRanges(newMatchRanges);
        this.ensureCurrentMatchInRange();
    };

    private ensureCurrentMatchInRange = () => {
        if (!this.submittedSearchTerm.trim() || this.totalMatches === 0) {
            this.setCurrentMatchIndex(null);
            return;
        }

        if (
            this.currentMatchIndex === null ||
            this.currentMatchIndex < 0 ||
            this.currentMatchIndex >= this.totalMatches
        ) {
            this.setCurrentMatchIndex(0);
        }
    };

    setSearchTerm = (value: string) => {
        const searchTermChanged = this.searchTerm !== value;
        this.searchTerm = value;
        this.setSubmittedSearchTerm(value);

        if (searchTermChanged) {
            this.hasProcessedAllPagesForCurrentSearch = false;
        }

        this.clearSearchDebounce();

        if (value.trim()) {
            this.recomputeMatches();
            this.scheduleBackgroundProcessing(value);
        } else {
            this.recomputeMatches();
            this.hasProcessedAllPagesForCurrentSearch = false;
        }
    };

    private clearSearchDebounce = () => {
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = null;
        }
    };

    private scheduleBackgroundProcessing = (value: string) => {
        const shouldProcessImmediately =
            !this.hasProcessedAllPagesForCurrentSearch && !this.isProcessingAllPages;

        if (shouldProcessImmediately) {
            this.processAllPagesForSearch().then(() => {
                this.hasProcessedAllPagesForCurrentSearch = true;
            });
        } else {
            this.searchDebounceTimer = setTimeout(async () => {
                if (this.searchTerm === value && value.trim() && !this.isProcessingAllPages) {
                    await this.processAllPagesForSearch();
                    this.hasProcessedAllPagesForCurrentSearch = true;
                }
            }, SEARCH_DEBOUNCE_MS);
        }
    };

    submitSearch = async () => {
        this.clearSearchDebounce();
        this.setSubmittedSearchTerm(this.searchTerm);

        this.recomputeMatches();

        if (this.searchTerm.trim() && !this.isProcessingAllPages) {
            await this.processAllPagesForSearch();
        }
    };

    /**
     * Processes all pages in the background using pdfjs directly (without rendering)
     * to extract text and compute matches across all pages
     */
    private processAllPagesForSearch = async () => {
        if (!this.canProcessPages()) {
            return;
        }

        this.isProcessingAllPages = true;

        try {
            this.ensurePdfJsWorkerConfigured();
            const pdfDocument = await this.loadPdfDocument();
            const pagePromises = this.createPageProcessingPromises(pdfDocument);
            await this.processPagesInBatches(pagePromises);
            this.recomputeMatches();
        } catch (err) {
            console.error("Error processing all pages for search:", err);
        } finally {
            this.isProcessingAllPages = false;
        }
    };

    private canProcessPages = (): boolean => {
        return !!(this.fileData && this.totalDocumentPages && this.submittedSearchTerm.trim());
    };

    private ensurePdfJsWorkerConfigured = () => {
        if (typeof window !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
            const workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
            pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
        }
    };

    private loadPdfDocument = async () => {
        if (!this.fileData) throw new Error("File data is required");

        const response = await fetch(this.fileData);
        const arrayBuffer = await response.arrayBuffer();

        const loadingTask = pdfjsLib.getDocument({
            data: arrayBuffer,
            useSystemFonts: true,
        });

        return loadingTask.promise;
    };

    private createPageProcessingPromises = (pdfDocument: Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>): Promise<void>[] => {
        const pagePromises: Promise<void>[] = [];
        const totalPages = pdfDocument.numPages;

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            // Skip pages that already have text (from rendered pages)
            if (this.pageJoinedTexts[pageNum]) {
                continue;
            }

            pagePromises.push(this.processSinglePage(pdfDocument, pageNum));
        }

        return pagePromises;
    };

    private processSinglePage = async (
        pdfDocument: Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>,
        pageNum: number
    ): Promise<void> => {
        try {
            const page = await pdfDocument.getPage(pageNum);
            const textContent = await page.getTextContent();

            if (!Array.isArray(textContent.items)) {
                return;
            }

            const processedText = this.processTextItems(textContent.items as TextItem[]);
            this.updatePageTextData(pageNum, processedText);
        } catch (err) {
            console.warn(`Error processing page ${pageNum}:`, err);
        }
    };

    private processPagesInBatches = async (pagePromises: Promise<void>[]): Promise<void> => {
        for (let i = 0; i < pagePromises.length; i += PAGE_PROCESSING_BATCH_SIZE) {
            const batch = pagePromises.slice(i, i + PAGE_PROCESSING_BATCH_SIZE);
            await Promise.all(batch);
        }
    };

    clearSearch = () => {
        this.setSearchTerm("");
        this.setSubmittedSearchTerm("");
        this.setPageMatches({});
        this.setPageMatchRanges({});
        this.setCurrentMatchIndex(null);
        this.hasProcessedAllPagesForCurrentSearch = false;
    };

    /**
     * Finds which page a given match index belongs to
     * @param matchIndex - The global match index (0-based)
     * @returns The page number (1-based) or null if not found
     */
    private getPageForMatchIndex = (matchIndex: number): number | null => {
        if (matchIndex < 0 || !this.totalDocumentPages) return null;

        let cumulativeMatches = 0;
        for (let page = 1; page <= this.totalDocumentPages; page++) {
            const matchesOnPage = this.pageMatches[page] || 0;
            if (matchIndex < cumulativeMatches + matchesOnPage) {
                return page;
            }
            cumulativeMatches += matchesOnPage;
        }
        return null;
    };

    nextMatch = () => {
        if (!this.totalMatches) return;
        if (this.currentMatchIndex === null) {
            this.setCurrentMatchIndex(0);
            const page = this.getPageForMatchIndex(0);
            if (page) this.setCurrentPage(page);
            return;
        }
        const nextIndex = (this.currentMatchIndex + 1) % this.totalMatches;
        this.setCurrentMatchIndex(nextIndex);
        const page = this.getPageForMatchIndex(nextIndex);
        if (page && page !== this.currentPage) {
            this.setCurrentPage(page);
        }
    };

    prevMatch = () => {
        if (!this.totalMatches) return;
        if (this.currentMatchIndex === null) {
            const prevIndex = this.totalMatches - 1;
            this.setCurrentMatchIndex(prevIndex);
            const page = this.getPageForMatchIndex(prevIndex);
            if (page) this.setCurrentPage(page);
            return;
        }
        const prevIndex = (this.currentMatchIndex - 1 + this.totalMatches) % this.totalMatches;
        this.setCurrentMatchIndex(prevIndex);
        const page = this.getPageForMatchIndex(prevIndex);
        if (page && page !== this.currentPage) {
            this.setCurrentPage(page);
        }
    };

    scrollCurrentMatchIntoView = (container: HTMLDivElement | null) => {
        if (this.currentMatchIndex === null || this.totalMatches === 0 || !container) {
            return;
        }

        // Delay to give pdf.js text layer time to render, especially when navigating to a new page
        setTimeout(() => {
            const el = this.findMatchElement(container);
            if (el) {
                this.scrollElementIntoView(el);
            } else {
                // Retry once more after a longer delay (page might still be rendering)
                setTimeout(() => {
                    const retryEl = this.findMatchElement(container);
                    if (retryEl) {
                        this.scrollElementIntoView(retryEl);
                    }
                }, SCROLL_RETRY_DELAY_MS);
            }
        }, SCROLL_INITIAL_DELAY_MS);
    };

    private findMatchElement = (container: HTMLDivElement): HTMLElement | null => {
        return container.querySelector<HTMLElement>(
            `[data-match-idx="${this.currentMatchIndex}"]`
        );
    };

    private scrollElementIntoView = (element: HTMLElement) => {
        element.scrollIntoView({
            behavior: "smooth",
            block: "center",
        });
    };

    /**
     * Calculates the total number of matches before the given page
     */
    getMatchCountBeforePage = (pageNumber: number): number => {
        let matchCounter = 0;
        for (let p = 1; p < pageNumber; p++) {
            matchCounter += this.pageMatches[p] || 0;
        }
        return matchCounter;
    };

    /**
     * Finds matches that overlap with the current text item range
     */
    findOverlappingMatches = (
        pageNumber: number,
        matchRanges: MatchRange[],
        currentItemRange: ItemRange,
        strLength: number
    ): OverlappingMatch[] => {
        const overlappingMatches: OverlappingMatch[] = [];
        const matchCounter = this.getMatchCountBeforePage(pageNumber);

        matchRanges.forEach((matchRange, idx) => {
            const overlapStart = Math.max(matchRange.start, currentItemRange.start);
            const overlapEnd = Math.min(matchRange.end, currentItemRange.end);

            if (overlapStart < overlapEnd) {
                const localStart = Math.max(0, matchRange.start - currentItemRange.start);
                const localEnd = Math.min(strLength, matchRange.end - currentItemRange.start);

                overlappingMatches.push({
                    matchStart: matchRange.start,
                    matchEnd: matchRange.end,
                    localStart,
                    localEnd,
                    globalIndex: matchCounter + idx,
                });
            }
        });

        return overlappingMatches.sort((a, b) => a.localStart - b.localStart);
    };

    /**
     * Handles document load errors
     */
    handleDocumentLoadError = (err: unknown) => {
        console.error(err);
        this.setError(
            err instanceof Error ? err.message : "Error loading PDF for display."
        );
    };
}