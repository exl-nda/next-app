import { makeAutoObservable } from "mobx";
// import { BridgeRootStore } from "../BridgeRootStore";
import * as pdfjsLib from "pdfjs-dist";

type MatchRange = { start: number; end: number };
type ItemRange = { start: number; end: number };

const escapeRegex = (value: string) => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

export class PdfViewerStore {
    // root: BridgeRootStore;
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

    constructor() {
        // this.root = root;
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
        this.setPageMatches({});
        this.setPageTexts({});
        this.setPageJoinedTexts({});
        this.setPageMatchRanges({});
        this.setPageTextItemRanges({});
        this.setCurrentMatchIndex(null);
    };

    handlePageTextSuccess = (pageNumber: number, items: any) => {
        const rawItems = Array.isArray(items) ? items : items?.items;

        if (!Array.isArray(rawItems)) {
            console.warn("Unexpected onGetTextSuccess payload", items);
            return;
        }

        const typedItems = rawItems as Array<{ str?: string }>;
        const textArray = typedItems.map((item) => item.str ?? "");

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

        const joinedText = joinedParts.join(" ");

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

        // Only recompute if we're not processing all pages in background
        // (to avoid duplicate work and incremental updates)
        if (!this.isProcessingAllPages) {
            this.recomputeMatches();
        }
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

    private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private hasProcessedAllPagesForCurrentSearch = false;

    setSearchTerm = (value: string) => {
        const searchTermChanged = this.searchTerm !== value;
        this.searchTerm = value;
        this.setSubmittedSearchTerm(value);

        // If search term changed significantly, reset the processed flag
        if (searchTermChanged) {
            this.hasProcessedAllPagesForCurrentSearch = false;
        }

        // Clear any pending debounce
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = null;
        }

        if (value.trim()) {
            // Immediately recompute with pages we already have
            this.recomputeMatches();

            // Then process all pages in the background to get accurate total match count
            // Use debounce to avoid processing on every keystroke
            // But process immediately if we haven't processed for this search term yet
            const shouldProcessImmediately = !this.hasProcessedAllPagesForCurrentSearch && !this.isProcessingAllPages;

            if (shouldProcessImmediately) {
                console.log("setSearchTerm: Processing immediately (first time for this term)");
                this.processAllPagesForSearch().then(() => {
                    this.hasProcessedAllPagesForCurrentSearch = true;
                });
            } else {
                this.searchDebounceTimer = setTimeout(async () => {
                    console.log("Debounce timer fired", {
                        currentSearchTerm: this.searchTerm,
                        originalValue: value,
                        isProcessing: this.isProcessingAllPages,
                    });
                    if (this.searchTerm === value && value.trim() && !this.isProcessingAllPages) {
                        await this.processAllPagesForSearch();
                        this.hasProcessedAllPagesForCurrentSearch = true;
                    }
                }, 300);
            }
        } else {
            // Clear search immediately if term is empty
            this.recomputeMatches();
            this.hasProcessedAllPagesForCurrentSearch = false;
        }
    };

    submitSearch = async () => {
        // Clear debounce timer
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = null;
        }

        this.setSubmittedSearchTerm(this.searchTerm);
        if (this.searchTerm.trim()) {
            // Immediately recompute with pages we already have
            this.recomputeMatches();
            // Then process all pages in background immediately (no debounce for explicit submit)
            if (!this.isProcessingAllPages) {
                console.log("submitSearch: Starting background processing");
                await this.processAllPagesForSearch();
            } else {
                console.log("submitSearch: Already processing, skipping");
            }
        } else {
            this.recomputeMatches();
        }
    };

    /**
     * Processes all pages in the background using pdfjs directly (without rendering)
     * to extract text and compute matches across all pages
     */
    private processAllPagesForSearch = async () => {
        if (!this.fileData || !this.totalDocumentPages || !this.submittedSearchTerm.trim()) {
            console.log("processAllPagesForSearch: Early return", {
                hasFileData: !!this.fileData,
                totalPages: this.totalDocumentPages,
                searchTerm: this.submittedSearchTerm,
            });
            return;
        }

        console.log("processAllPagesForSearch: Starting", {
            totalPages: this.totalDocumentPages,
            pagesWithText: Object.keys(this.pageJoinedTexts).length,
        });

        this.isProcessingAllPages = true;

        try {
            // Ensure pdfjs worker is configured (it should be set globally in PdfViewerClient)
            // If not configured, try to set it
            if (typeof window !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
                const workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
                pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
                console.log("processAllPagesForSearch: Configured pdfjs worker");
            }

            // Convert data URL to ArrayBuffer for pdfjs
            const response = await fetch(this.fileData);
            const arrayBuffer = await response.arrayBuffer();

            // Load the PDF document using pdfjs directly
            const loadingTask = pdfjsLib.getDocument({
                data: arrayBuffer,
                useSystemFonts: true,
            });

            const pdfDocument = await loadingTask.promise;
            const totalPages = pdfDocument.numPages;
            console.log("processAllPagesForSearch: Loaded PDF, total pages:", totalPages);

            // Process all pages that don't have text yet
            const pagePromises: Promise<void>[] = [];
            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                // Skip if we already have text for this page (from rendered page)
                // But we still need to include it in match calculation
                if (this.pageJoinedTexts[pageNum]) {
                    // This page already has text, so it will be included in recomputeMatches
                    // We just need to make sure recomputeMatches runs after we process other pages
                    continue;
                }

                pagePromises.push(
                    (async () => {
                        try {
                            const page = await pdfDocument.getPage(pageNum);
                            const textContent = await page.getTextContent();

                            const rawItems = textContent.items;
                            if (!Array.isArray(rawItems)) {
                                return;
                            }

                            const typedItems = rawItems as Array<{ str?: string }>;
                            const textArray = typedItems.map((item) => item.str ?? "");

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

                            const joinedText = joinedParts.join(" ");

                            // Update store with extracted text
                            this.setPageTexts({
                                ...this.pageTexts,
                                [pageNum]: textArray,
                            });

                            this.setPageJoinedTexts({
                                ...this.pageJoinedTexts,
                                [pageNum]: joinedText,
                            });

                            this.setPageTextItemRanges({
                                ...this.pageTextItemRanges,
                                [pageNum]: itemRanges,
                            });

                            // Don't recompute matches after each page - wait until all pages are processed
                        } catch (err) {
                            console.warn(`Error processing page ${pageNum}:`, err);
                        }
                    })()
                );
            }

            console.log("processAllPagesForSearch: Processing", pagePromises.length, "pages");

            // Process pages in batches to avoid overwhelming the browser
            const batchSize = 5;
            for (let i = 0; i < pagePromises.length; i += batchSize) {
                const batch = pagePromises.slice(i, i + batchSize);
                await Promise.all(batch);
                console.log(`processAllPagesForSearch: Processed batch ${Math.floor(i / batchSize) + 1}, pages with text:`, Object.keys(this.pageJoinedTexts).length);
            }

            console.log("processAllPagesForSearch: Completed", {
                pagesProcessed: pagePromises.length,
                totalPagesWithText: Object.keys(this.pageJoinedTexts).length,
                expectedTotalPages: totalPages,
            });

            // Final recompute to ensure all pages (including already-loaded ones) are included
            this.recomputeMatches();
            console.log("processAllPagesForSearch: Total matches after recompute:", this.totalMatches);
        } catch (err) {
            console.error("Error processing all pages for search:", err);
        } finally {
            this.isProcessingAllPages = false;
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
        if (this.currentMatchIndex === null || this.totalMatches === 0) return;
        if (!container) return;

        // Delay to give pdf.js text layer time to render, especially when navigating to a new page
        window.setTimeout(() => {
            const el = container.querySelector<HTMLElement>(
                `[data-match-idx="${this.currentMatchIndex}"]`,
            );
            if (!el) {
                // If element not found, retry once more after a longer delay (page might still be rendering)
                window.setTimeout(() => {
                    const retryEl = container.querySelector<HTMLElement>(
                        `[data-match-idx="${this.currentMatchIndex}"]`,
                    );
                    if (retryEl) {
                        retryEl.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                        });
                    }
                }, 200);
                return;
            }

            el.scrollIntoView({
                behavior: "smooth",
                block: "center",
            });
        }, 100);
    };
}