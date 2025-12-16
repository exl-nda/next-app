'use client';

import { usePdfViewerStore } from "@/stores/RootStoreProvider";

// Simple icon components
const ChevronLeft = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const ChevronRight = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const ZoomIn = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 7V4M7 7V10M7 7H4M7 7H10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
        <path d="M11 11L14 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

const ZoomOut = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 7H10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
        <path d="M11 11L14 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

const Close = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const ArrowUp = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 12V4M8 4L4 8M8 4L12 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const ArrowDown = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 4V12M8 12L4 8M8 12L12 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// Simple IconButton component
const IconButton = ({
    icon: Icon,
    onPress,
    isDisabled = false,
    iconTitle,
    className = "",
    size = "medium"
}: {
    icon: React.ComponentType;
    onPress: () => void;
    isDisabled?: boolean;
    iconTitle?: string;
    className?: string;
    size?: "small" | "medium";
}) => {
    const sizeClasses = size === "small" ? "p-1.5" : "p-2";
    return (
        <button
            onClick={onPress}
            disabled={isDisabled}
            className={`inline-flex items-center justify-center rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed ${sizeClasses} ${className}`}
            title={iconTitle}
            aria-label={iconTitle}
        >
            <Icon />
        </button>
    );
};

export const PdfViewerToolbar = () => {
    const {
        pageNumbersOptions,
        totalDocumentPages,
        currentPage,
        setCurrentPage,
        scale,
        setScale,
        searchTerm,
        setSearchTerm,
        clearSearch,
        totalMatches,
        prevMatch,
        nextMatch,
        currentMatchIndex
    } = usePdfViewerStore();

    const onSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
    };

    const pageNumberSelection = () => {
        return (
            <select
                value={String(currentPage)}
                onChange={(e) => setCurrentPage(Number(e.target.value))}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-sm outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500"
                aria-label="Page Number Selection"
            >
                {pageNumbersOptions.map((option) => (
                    <option key={option.id} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        );
    };

    return (
        <div className='flex flex-col'>
            <div className="flex  items-center justify-between">
                <div className="flex flex-row items-center gap-2">
                    <IconButton
                        icon={ChevronLeft}
                        onPress={() => setCurrentPage(currentPage - 1)}
                        isDisabled={currentPage <= 1}
                        iconTitle="Prev Page"
                        size="small"
                    />
                    <div className="flex flex-row items-center gap-4">
                        {pageNumberSelection()}
                        <span className="whitespace-nowrap"> / {totalDocumentPages ?? '—'} </span>
                    </div>
                    <IconButton
                        icon={ChevronRight}
                        onPress={() => setCurrentPage(currentPage + 1)}
                        isDisabled={!totalDocumentPages || currentPage >= totalDocumentPages}
                        iconTitle="Next Page"
                        size="small"
                    />
                </div>
                <div className="flex flex-row items-center gap-2">
                    <IconButton
                        icon={ZoomIn}
                        onPress={() => setScale(Math.min(scale + 0.1, 3))}
                        isDisabled={scale >= 3}
                        size="medium"
                    />

                    <IconButton
                        icon={ZoomOut}
                        onPress={() => setScale(Math.max(scale - 0.1, 0.5))}
                        isDisabled={scale <= 0.5}
                        size="medium"
                    />
                </div>
                <div className="flex items-center  ml-6 gap-4">
                    <div className="relative inline-flex w-full items-center">
                        <input
                            type="text"
                            value={searchTerm}
                            placeholder="Search in page"
                            onChange={onSearchChange}
                            className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500 pr-8"
                        />
                        {searchTerm && (
                            <IconButton
                                icon={Close}
                                className="absolute right-2 text-gray-500 hover:text-black"
                                onPress={clearSearch}
                            />
                        )}
                    </div>

                </div>
            </div>
            {totalMatches > 0 &&
                currentMatchIndex !== null && (
                    <div className="flex items-center ">
                        <span className="text-t-secondary text-12 whitespace-nowrap ml-auto">
                            <div>
                                Matches in Page:{" "}

                                <span className="text-[11px] text-zinc-700">
                                    <span className="font-semibold">
                                        {currentMatchIndex + 1}
                                    </span>{" "}
                                    / {totalMatches}
                                </span>

                            </div>
                        </span>
                        <div className="flex items-center">
                            <IconButton
                                icon={ArrowUp}
                                iconTitle="Prev"
                                className="px-0 mx-0"
                                size="small"
                                isDisabled={totalMatches === 0}
                                onPress={() => prevMatch()}
                            />

                            <IconButton
                                icon={ArrowDown}
                                iconTitle="Next"
                                className="px-0 mx-0"
                                size="small"
                                isDisabled={totalMatches === 0}
                                onPress={() => nextMatch()}
                            />
                        </div>
                    </div>
                )}
        </div>
    );
};
