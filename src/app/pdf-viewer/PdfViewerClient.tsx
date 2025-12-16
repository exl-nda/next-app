"use client";

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { PdfViewerToolbar } from "./PdfViewerToolbar";
import { usePdfViewerStore } from "@/stores/RootStoreProvider";

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
        pageMatches,
        fetchPdf,
        handleDocumentLoadSuccess,
        scrollCurrentMatchIntoView,
        setError,
        handlePageTextSuccess,
    } = usePdfViewerStore();

    const viewerRef = useRef<HTMLDivElement | null>(null);

    const [pageWidth, setPageWidth] = useState<number | undefined>(600);

    // Initialise store and start fetching PDF based on URL
    useEffect(() => {
        fetchPdf(file);
    }, []);

    // Auto-fit width when container resizes
    useEffect(() => {
        const el = viewerRef.current;
        if (!el) return;
        const observer = new ResizeObserver(() => {
            const w = el.clientWidth;
            // Provide some padding margin
            setPageWidth(Math.max(300, Math.min(w - 32, 800)));
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Scroll the current match into view inside the PDF container when it changes
    useEffect(() => {
        scrollCurrentMatchIntoView(viewerRef.current);
    }, [currentMatchIndex, totalMatches, currentPage]);

    // Note: this stays in the React component (and not in the MobX store)
    // because it is a pure view concern, tightly coupled to react-pdf's
    // rendering cycle and the DOM:
    // - it returns the customTextRenderer function that Page expects
    // - it relies on a per-render closure variable (itemIndex) that must reset
    //   on each React render of the page
    // - it turns store data (match ranges) into HTML/markup and data attributes.
    // The store remains UI-agnostic and only exposes computed state such as
    // pageTextItemRanges, pageMatchRanges, and currentMatchIndex; this function
    // consumes that state to decide *how* to highlight text.
    const createTextRenderer = (pageNumber: number) => {
        let itemIndex = 0;

        return ({ str }: { str: string }) => {
            const term = submittedSearchTerm.trim();
            if (!term) {
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

            const overlappingMatches: Array<{
                matchStart: number;
                matchEnd: number;
                localStart: number;
                localEnd: number;
                globalIndex: number;
            }> = [];

            let matchCounter = 0;
            for (let p = 1; p < pageNumber; p++) {
                matchCounter += pageMatches[p] || 0;
            }

            matchRanges.forEach((matchRange, idx) => {
                const overlapStart = Math.max(
                    matchRange.start,
                    currentItemRange.start,
                );
                const overlapEnd = Math.min(matchRange.end, currentItemRange.end);

                if (overlapStart < overlapEnd) {
                    const localStart = Math.max(
                        0,
                        matchRange.start - currentItemRange.start,
                    );
                    const localEnd = Math.min(
                        str.length,
                        matchRange.end - currentItemRange.start,
                    );

                    overlappingMatches.push({
                        matchStart: matchRange.start,
                        matchEnd: matchRange.end,
                        localStart,
                        localEnd,
                        globalIndex: matchCounter + idx,
                    });
                }
            });

            if (overlappingMatches.length === 0) {
                itemIndex++;
                return str;
            }

            overlappingMatches.sort((a, b) => a.localStart - b.localStart);

            let result = "";
            let lastIndex = 0;

            overlappingMatches.forEach((match) => {
                if (match.localStart > lastIndex) {
                    result += str.substring(lastIndex, match.localStart);
                }

                const matchText = str.substring(match.localStart, match.localEnd);
                const isCurrent = currentMatchIndex === match.globalIndex;
                const baseStyle = "color: black;";
                const bgStyle = isCurrent
                    ? "background-color: #3b82f6; color: white;"
                    : "background-color: yellow; color: black;";

                result += `<span data-match-idx="${match.globalIndex}" style="${baseStyle} ${bgStyle}">${matchText}</span>`;
                lastIndex = match.localEnd;
            });

            if (lastIndex < str.length) {
                result += str.substring(lastIndex);
            }

            itemIndex++;
            return result;
        };
    };

    return (
        <div className="flex min-h-screen flex-col bg-zinc-50 px-4 py-6 text-zinc-900">
            <header className="sticky top-0 z-10 mx-auto flex w-full max-w-4xl flex-col gap-2 border-b border-zinc-200 bg-zinc-50 pb-4">
                <PdfViewerToolbar />
            </header>


            <main className="mx-auto mt-4 flex w-full max-w-4xl flex-1 flex-col items-center justify-start gap-4">
                {isLoading && (
                    <p>Loading...</p>
                )}

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
                            onLoadError={(err) => {
                                console.error(err);
                                setError(
                                    err instanceof Error
                                        ? err.message
                                        : "Error loading PDF for display.",
                                );
                            }}
                        >
                            <Page
                                key={`page_${currentPage}-${submittedSearchTerm}`}
                                pageNumber={currentPage}
                                width={pageWidth}
                                scale={scale}
                                customTextRenderer={createTextRenderer(currentPage)}
                                onGetTextSuccess={(items) =>
                                    handlePageTextSuccess(
                                        currentPage,
                                        items,
                                    )
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