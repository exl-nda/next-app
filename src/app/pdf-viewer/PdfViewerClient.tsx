"use client";

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { PdfViewerToolbar } from "./PdfViewerToolbar";
import { usePdfViewerStore } from "@/stores/RootStoreProvider";
import type { OverlappingMatch } from "./pdfViewerStore";

// Constants
const MIN_PAGE_WIDTH = 300;
const MAX_PAGE_WIDTH = 800;
const PAGE_PADDING = 32;
const DEFAULT_PAGE_WIDTH = 600;

// Configure pdfjs worker (required by react-pdf)
if (typeof window !== "undefined") {
    const workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
}

type Props = {
    file: string;
};

function PdfViewer({ file }: Props) {
    const {
        isLoading,
        error,
        fileData,
        scale,
        currentPage,
        currentMatchIndex,
        totalMatches,
        submittedSearchTerm,
        pageTextItemRanges,
        pageMatchRanges,
        fetchPdf,
        handleDocumentLoadSuccess,
        scrollCurrentMatchIntoView,
        handlePageTextSuccess,
        findOverlappingMatches,
        handleDocumentLoadError,
    } = usePdfViewerStore();

    const viewerRef = useRef<HTMLDivElement | null>(null);
    const [pageWidth, setPageWidth] = useState<number | undefined>(DEFAULT_PAGE_WIDTH);

    // Initialize store and start fetching PDF based on URL
    useEffect(() => {
        fetchPdf(file);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file]);

    // Auto-fit width when container resizes
    useEffect(() => {
        const el = viewerRef.current;
        if (!el) return;

        const updatePageWidth = () => {
            const containerWidth = el.clientWidth;
            const calculatedWidth = Math.max(
                MIN_PAGE_WIDTH,
                Math.min(containerWidth - PAGE_PADDING, MAX_PAGE_WIDTH)
            );
            setPageWidth(calculatedWidth);
        };

        const observer = new ResizeObserver(updatePageWidth);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Scroll the current match into view inside the PDF container when it changes
    useEffect(() => {
        scrollCurrentMatchIntoView(viewerRef.current);
    }, [currentMatchIndex, totalMatches, currentPage, scrollCurrentMatchIntoView]);

    /**
     * Creates a text renderer function for highlighting search matches.
     * This stays in the React component (not in the MobX store) because it is a pure view concern,
     * tightly coupled to react-pdf's rendering cycle and the DOM.
     */
    const createTextRenderer = (pageNumber: number) => {
        let itemIndex = 0;

        return ({ str }: { str: string }) => {
            if (!submittedSearchTerm.trim()) {
                itemIndex++;
                return str;
            }

            const itemRanges = pageTextItemRanges[pageNumber] || [];
            const matchRanges = pageMatchRanges[pageNumber] || [];
            const currentItemRange = itemRanges[itemIndex];

            if (!currentItemRange) {
                itemIndex++;
                return str;
            }

            const overlappingMatches = findOverlappingMatches(
                pageNumber,
                matchRanges,
                currentItemRange,
                str.length
            );

            if (overlappingMatches.length === 0) {
                itemIndex++;
                return str;
            }

            const result = renderHighlightedText(str, overlappingMatches);
            itemIndex++;
            return result;
        };
    };


    /**
     * Renders text with highlighted matches
     */
    const renderHighlightedText = (
        str: string,
        overlappingMatches: OverlappingMatch[]
    ): string => {
        let result = "";
        let lastIndex = 0;

        overlappingMatches.forEach((match) => {
            if (match.localStart > lastIndex) {
                result += str.substring(lastIndex, match.localStart);
            }

            const matchText = str.substring(match.localStart, match.localEnd);
            const isCurrent = currentMatchIndex === match.globalIndex;
            const highlightStyle = getHighlightStyle(isCurrent);

            result += `<span data-match-idx="${match.globalIndex}" style="${highlightStyle}">${matchText}</span>`;
            lastIndex = match.localEnd;
        });

        if (lastIndex < str.length) {
            result += str.substring(lastIndex);
        }

        return result;
    };

    /**
     * Returns the CSS style for highlighting based on whether it's the current match
     */
    const getHighlightStyle = (isCurrent: boolean): string => {
        const baseStyle = "color: black;";
        const bgStyle = isCurrent
            ? "background-color: #3b82f6; color: white;"
            : "background-color: yellow; color: black;";
        return `${baseStyle} ${bgStyle}`;
    };

    return (
        <div className="flex min-h-screen flex-col bg-zinc-50 px-4 py-6 text-zinc-900">
            <header className="sticky top-0 z-10 mx-auto flex w-full max-w-4xl flex-col gap-2 border-b border-zinc-200 bg-zinc-50 pb-4">
                <PdfViewerToolbar />
            </header>


            <main className="mx-auto mt-4 flex w-full max-w-4xl flex-1 flex-col items-center justify-start gap-4">
                {isLoading && <p>Loading...</p>}

                {error && (
                    <div className="mt-8 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        <p className="font-medium">Error</p>
                        <p>{error}</p>
                    </div>
                )}

                {fileData && (
                    <div
                        ref={viewerRef}
                        className="mt-4 w-full max-w-3xl overflow-auto rounded border border-zinc-200 bg-white p-3 shadow-sm"
                    >
                        <Document
                            file={fileData}
                            onLoadSuccess={handleDocumentLoadSuccess}
                            onLoadError={handleDocumentLoadError}
                        >
                            <Page
                                key={`page_${currentPage}-${submittedSearchTerm}`}
                                pageNumber={currentPage}
                                width={pageWidth}
                                scale={scale}
                                customTextRenderer={createTextRenderer(currentPage)}
                                onGetTextSuccess={(items) =>
                                    handlePageTextSuccess(currentPage, items)
                                }
                            />
                        </Document>
                    </div>
                )}
            </main>
        </div>
    );
};

export default observer(PdfViewer);