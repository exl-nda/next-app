"use client";

/* eslint-disable @typescript-eslint/no-floating-promises */

import { useEffect, useRef } from "react";
import { observer } from "mobx-react-lite";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

import { pdfViewerStore } from "./pdfViewerStore";

// Configure pdfjs worker (required by react-pdf)
if (typeof window !== "undefined") {
    const workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
}

const PdfViewerClient = observer(function PdfViewerClient() {
    const viewerRef = useRef<HTMLDivElement | null>(null);

    // Initialise store and start fetching PDF based on URL
    useEffect(() => {
        pdfViewerStore.initialiseFromLocation();
    }, []);

    // Scroll the current match into view inside the PDF container when it changes
    useEffect(() => {
        pdfViewerStore.scrollCurrentMatchIntoView(viewerRef.current);
    }, [pdfViewerStore.currentMatchIndex, pdfViewerStore.totalMatches]);

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
            const term = pdfViewerStore.submittedSearchTerm.trim();
            if (!term) {
                itemIndex++;
                return str;
            }

            const itemRanges = pdfViewerStore.pageTextItemRanges[pageNumber] || [];
            const matchRanges = pdfViewerStore.pageMatchRanges[pageNumber] || [];
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
                matchCounter += pdfViewerStore.pageMatches[p] || 0;
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
                const isCurrent = pdfViewerStore.currentMatchIndex === match.globalIndex;
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
                <h1 className="text-xl font-semibold">PDF Viewer</h1>
                <p className="text-sm text-zinc-600">Downloading and displaying PDF from:</p>
                <code className="break-all rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-700">
                    {pdfViewerStore.pdfUrl}
                </code>
                <p className="text-xs text-zinc-500">
                    You can change the PDF by opening{" "}
                    <span className="font-mono">/pdf-viewer?url=&lt;PDF_URL&gt;</span>.
                </p>

                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        pdfViewerStore.submitSearch();
                    }}
                    className="mt-3 flex flex-wrap items-center gap-2"
                >
                    <input
                        type="text"
                        value={pdfViewerStore.searchTerm}
                        onChange={(e) => {
                            const value = e.target.value;
                            pdfViewerStore.setSearchTerm(value);
                        }}
                        placeholder="Search in PDF text…"
                        className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
                    />
                    <button
                        type="submit"
                        className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                        disabled={!pdfViewerStore.searchTerm.trim()}
                    >
                        Search
                    </button>
                    <button
                        type="button"
                        onClick={() => pdfViewerStore.clearSearch()}
                        className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
                    >
                        Clear
                    </button>
                </form>

                <div className="mt-1 flex items-center gap-2 text-xs text-zinc-600">
                    <div>
                        Matches in document:{" "}
                        <span className="font-semibold">{pdfViewerStore.totalMatches}</span>
                        {pdfViewerStore.numPages
                            ? ` across ${pdfViewerStore.numPages} page(s)`
                            : ""}
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                        {pdfViewerStore.totalMatches > 0 &&
                            pdfViewerStore.currentMatchIndex !== null && (
                                <span className="text-[11px] text-zinc-700">
                                    <span className="font-semibold">
                                        {pdfViewerStore.currentMatchIndex + 1}
                                    </span>{" "}
                                    / {pdfViewerStore.totalMatches}
                                </span>
                            )}
                        <button
                            type="button"
                            onClick={() => pdfViewerStore.prevMatch()}
                            disabled={pdfViewerStore.totalMatches === 0}
                            className="rounded border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400"
                        >
                            Prev
                        </button>
                        <button
                            type="button"
                            onClick={() => pdfViewerStore.nextMatch()}
                            disabled={pdfViewerStore.totalMatches === 0}
                            className="rounded border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto mt-4 flex w-full max-w-4xl flex-1 flex-col items-center justify-start gap-4">
                {pdfViewerStore.isLoading && (
                    <div className="mt-8 text-sm text-zinc-600">Downloading PDF…</div>
                )}

                {pdfViewerStore.error && (
                    <div className="mt-8 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        <p className="font-medium">Error</p>
                        <p>{pdfViewerStore.error}</p>
                    </div>
                )}

                {pdfViewerStore.fileData && (
                    <div
                        ref={viewerRef}
                        className="mt-4 w-full max-w-3xl max-h-[calc(100vh-220px)] overflow-auto rounded border border-zinc-200 bg-white p-3 shadow-sm"
                    >
                        <Document
                            file={pdfViewerStore.fileData}
                            onLoadSuccess={pdfViewerStore.handleDocumentLoadSuccess}
                            onLoadError={(err) => {
                                console.error(err);
                                pdfViewerStore.setError(
                                    err instanceof Error
                                        ? err.message
                                        : "Error loading PDF for display.",
                                );
                            }}
                        >
                            {Array.from(
                                new Array(pdfViewerStore.numPages || 0),
                                (_el, index) => {
                                    const pageNum = index + 1;
                                    return (
                                        <Page
                                            key={`page_${pageNum}-${pdfViewerStore.submittedSearchTerm}`}
                                            pageNumber={pageNum}
                                            width={800}
                                            customTextRenderer={createTextRenderer(pageNum)}
                                            onGetTextSuccess={(items) =>
                                                pdfViewerStore.handlePageTextSuccess(
                                                    pageNum,
                                                    items,
                                                )
                                            }
                                        />
                                    );
                                },
                            )}
                        </Document>
                    </div>
                )}
            </main>
        </div>
    );
});

export default PdfViewerClient;
