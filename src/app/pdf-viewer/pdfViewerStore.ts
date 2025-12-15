import { makeAutoObservable } from "mobx";

const DEFAULT_PDF_URL = "https://pdfobject.com/pdf/sample.pdf";

type MatchRange = { start: number; end: number };
type ItemRange = { start: number; end: number };

const escapeRegex = (value: string) => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

class PdfViewerStore {
    pdfUrl = DEFAULT_PDF_URL;
    fileData: string | null = null;
    numPages: number | null = null;
    isLoading = false;
    error: string | null = null;

    searchTerm = "";
    submittedSearchTerm = "";
    pageMatches: Record<number, number> = {};
    pageTexts: Record<number, string[]> = {};
    pageJoinedTexts: Record<number, string> = {};
    pageMatchRanges: Record<number, MatchRange[]> = {};
    pageTextItemRanges: Record<number, ItemRange[]> = {};
    currentMatchIndex: number | null = null;

    constructor() {
        makeAutoObservable(this, {}, { autoBind: true });
    }

    get totalMatches(): number {
        return Object.values(this.pageMatches).reduce((sum, v) => sum + v, 0);
    }

    initialiseFromLocation() {
        const url = new URL(window.location.href);
        const urlParam = url.searchParams.get("url");
        const finalUrl = urlParam || DEFAULT_PDF_URL;
        this.pdfUrl = finalUrl;
        this.fetchPdf(finalUrl);
    }

    async fetchPdf(finalUrl: string) {
        try {
            this.isLoading = true;
            this.error = null;

            const response = await fetch(finalUrl);
            if (!response.ok) {
                throw new Error(`Failed to download PDF (status ${response.status})`);
            }

            const blob = await response.blob();
            const reader = new FileReader();

            reader.onloadend = () => {
                const result = reader.result;
                if (typeof result === "string") {
                    this.fileData = result;
                } else {
                    this.error = "Unable to read PDF file.";
                }
                this.isLoading = false;
            };

            reader.onerror = () => {
                this.isLoading = false;
                this.error = "Error reading PDF file.";
            };

            reader.readAsDataURL(blob);
        } catch (err) {
            console.error(err);
            this.isLoading = false;
            this.error =
                err instanceof Error ? err.message : "Unknown error downloading PDF.";
        }
    }

    handleDocumentLoadSuccess({ numPages }: { numPages: number }) {
        this.numPages = numPages;
        this.pageMatches = {};
        this.pageTexts = {};
        this.pageJoinedTexts = {};
        this.pageMatchRanges = {};
        this.pageTextItemRanges = {};
        this.currentMatchIndex = null;
    }

    handlePageTextSuccess(pageNumber: number, items: any) {
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

        this.pageTexts = {
            ...this.pageTexts,
            [pageNumber]: textArray,
        };

        this.pageJoinedTexts = {
            ...this.pageJoinedTexts,
            [pageNumber]: joinedText,
        };

        this.pageTextItemRanges = {
            ...this.pageTextItemRanges,
            [pageNumber]: itemRanges,
        };

        this.recomputeMatches();
    }

    private recomputeMatches() {
        const term = this.submittedSearchTerm.trim();
        if (!term) {
            this.pageMatches = {};
            this.pageMatchRanges = {};
            this.currentMatchIndex = null;
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

        this.pageMatches = newMatches;
        this.pageMatchRanges = newMatchRanges;
        this.ensureCurrentMatchInRange();
    }

    private ensureCurrentMatchInRange() {
        if (!this.submittedSearchTerm.trim() || this.totalMatches === 0) {
            this.currentMatchIndex = null;
            return;
        }

        if (
            this.currentMatchIndex === null ||
            this.currentMatchIndex < 0 ||
            this.currentMatchIndex >= this.totalMatches
        ) {
            this.currentMatchIndex = 0;
        }
    }

    setSearchTerm(value: string) {
        this.searchTerm = value;
        this.submittedSearchTerm = value;
        this.recomputeMatches();
    }

    submitSearch() {
        this.submittedSearchTerm = this.searchTerm;
        this.recomputeMatches();
    }

    clearSearch() {
        this.searchTerm = "";
        this.submittedSearchTerm = "";
        this.pageMatches = {};
        this.pageMatchRanges = {};
        this.currentMatchIndex = null;
    }

    nextMatch() {
        if (!this.totalMatches) return;
        if (this.currentMatchIndex === null) {
            this.currentMatchIndex = 0;
            return;
        }
        this.currentMatchIndex = (this.currentMatchIndex + 1) % this.totalMatches;
    }

    prevMatch() {
        if (!this.totalMatches) return;
        if (this.currentMatchIndex === null) {
            this.currentMatchIndex = this.totalMatches - 1;
            return;
        }
        this.currentMatchIndex =
            (this.currentMatchIndex - 1 + this.totalMatches) % this.totalMatches;
    }

    setError(message: string | null) {
        this.error = message;
    }

    scrollCurrentMatchIntoView(container: HTMLDivElement | null) {
        if (this.currentMatchIndex === null || this.totalMatches === 0) return;
        if (!container) return;

        // Delay slightly to give pdf.js text layer time to render
        window.setTimeout(() => {
            const el = container.querySelector<HTMLElement>(
                `[data-match-idx="${this.currentMatchIndex}"]`,
            );
            if (!el) return;

            el.scrollIntoView({
                behavior: "smooth",
                block: "center",
            });
        }, 50);
    }
}

export const pdfViewerStore = new PdfViewerStore();

