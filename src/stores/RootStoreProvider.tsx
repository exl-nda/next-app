"use client";

import React, { createContext, useContext, ReactNode, useMemo } from "react";
import { RootStore } from "./rootStore";

const RootStoreContext = createContext<RootStore | null>(null);

export const useRootStore = () => {
    const store = useContext(RootStoreContext);
    if (!store) {
        throw new Error("useRootStore must be used within RootStoreProvider");
    }
    return store;
};

export const usePdfViewerStore = () => {
    const { pdfViewerStore } = useRootStore();
    return pdfViewerStore;
};

interface RootStoreProviderProps {
    children: ReactNode;
}

export function RootStoreProvider({ children }: RootStoreProviderProps) {
    const store = useMemo(() => new RootStore(), []);

    return (
        <RootStoreContext.Provider value={store}>
            {children}
        </RootStoreContext.Provider>
    );
}

