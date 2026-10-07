export declare function stringify(value: unknown, _replacer?: unknown, space?: string | number): string;
export declare const textResult: (value: unknown) => {
    content: {
        type: "text";
        text: string;
    }[];
};
export declare class ResultPages {
    private entries;
    put(text: string): {
        status: string;
        resultId: string;
        format: string;
        offset: number;
        page: string;
        nextOffset: number | null;
        totalCharacters: number;
        expiresAt: string;
    };
    read(id: string, start: number, count: number): {
        status: string;
        resultId: string;
        format: string;
        offset: number;
        page: string;
        nextOffset: number | null;
        totalCharacters: number;
        expiresAt: string;
    };
    wrap(result: any): any;
    clear(): void;
}
