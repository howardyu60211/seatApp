import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from "@headlessui/react";
import {
    Fragment,
    useCallback,
    useEffect,
    useRef,
    useState,
    type DragEvent,
    type MouseEvent,
    type SubmitEvent,
} from "react";
import { exportSeatLayoutAsPdf, exportSeatLayoutAsPng } from "./seatExport";
import StatusBar from "./seatBar";
import {
    createSeat,
    createSeatLayout,
    createSeatList,
    seatStatus,
    shuffle,
    type Seat,
    type SeatLayout,
    type SeatStudent,
} from "./seatModel";
import {
    ARRANGE_MODE_LABELS,
    arrangeSeats,
    EXAM_PATTERN_LABELS,
    NUMERIC_GROUPING_LABELS,
    NUMERIC_ORDER_LABELS,
    type ArrangeMode,
    type ExamPattern,
    type NumericGrouping,
    type NumericOrder,
} from "./seatArrange";

export { seatStatus, type Seat } from "./seatModel";

interface SeatHistoryEntry extends SeatLayout {
    id: string;
    name: string;
    createdAt: number;
}

interface OperationNotice {
    message: string;
}

interface SeatMenuState {
    index: number;
    x: number;
    y: number;
}

type StoredSeat = Omit<Seat, "pinned" | "tag"> & {
    pinned?: unknown;
    tag?: unknown;
};

type StoredSeatHistoryEntry = Omit<SeatHistoryEntry, "name" | "seats"> & {
    name?: unknown;
    seats: StoredSeat[];
};

type ImportFormatMode = "join-row" | "selected-columns";
type ImportTagSource = "none" | "order" | "column";
type ExportFormat = "xlsx" | "pdf" | "png";

interface ImportSettings {
    formatMode: ImportFormatMode;
    separator: string;
    columns: string;
    skipFirstRow: boolean;
    tagSource: ImportTagSource;
    /** 1-based 欄位編號，只有 tagSource 為 column 時會用到。 */
    tagColumn: string;
}

/** 讀進來的單一工作表，rows 是 sheet_to_json 的二維陣列。 */
interface ImportSheet {
    name: string;
    rows: unknown[][];
}

/** 已讀檔、等待使用者在預覽視窗確認的匯入來源。 */
interface ImportSource {
    fileName: string;
    sheets: ImportSheet[];
    sheetName: string;
}

const IMPORT_TAG_SOURCE_LABELS: Record<ImportTagSource, string> = {
    none: "不記憶",
    order: "依名單順序",
    column: "指定欄位",
};

const IMPORT_TAG_SOURCE_HINTS: Record<ImportTagSource, string> = {
    none: "匯入的學生不會帶排序依據，只能用完全隨機排座位。",
    order: "照名單由上往下編號 1、2、3…，適合座號或已經排好序的名單。",
    column: "記住指定欄的值（例如成績、組別、性別）。Excel 的 A 欄是第 1 欄。",
};

const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
    xlsx: "XLSX",
    pdf: "PDF",
    png: "PNG",
};

const ARRANGE_MODE_HINTS: Record<ArrangeMode, string> = {
    random: "再抽一次會把未釘選的學生重新隨機分配；已釘選（名字前有圖釘）的座位會留在原位。",
    category: "依匯入時記住的排序依據分類，讓相鄰座位盡量落在不同類別，座位之間不留空白。",
    exam: "先依座位圖樣留出空位，再把學生填進剩下的座位，適合安排考試座位。",
    numeric: "依排序依據的數值大小，照選定的填入方式依序排入座位；沒有數值的學生會排在最後。",
};

const DEFAULT_ROW_COUNT = 6;
const DEFAULT_COL_COUNT = 8;
const MAX_ROW_COUNT = 29;
const MAX_COL_COUNT = 11;
const MAX_HISTORY_COUNT = 30;
const MAX_UNDO_COUNT = 50;
const HISTORY_STORAGE_KEY = "seatapp.favorite-seat-layouts.v1";
const IMPORT_SETTINGS_STORAGE_KEY = "seatapp.import-settings.v1";
const SEAT_MENU_WIDTH = 168;
const SEAT_MENU_ITEM_HEIGHT = 34;
const SEAT_MENU_PADDING = 8;
const MAX_RESHUFFLE_ATTEMPT = 8;
const SEAT_SETTLE_STEP = 40;
const SEAT_SETTLE_MAX_DELAY = 700;
// 拖曳時用自訂 MIME 型別區分座位／整列／整欄，dragover 只能讀到 types。
const SEAT_DRAG_TYPE = "application/x-seat-index";
const ROW_DRAG_TYPE = "application/x-seat-row";
const COLUMN_DRAG_TYPE = "application/x-seat-column";
const SEAT_SETTLE_DURATION = 260;
const MAX_IMPORT_PREVIEW_ROW = 3;
const MAX_IMPORT_PREVIEW_COLUMN = 26;

const DEFAULT_IMPORT_SETTINGS: ImportSettings = {
    formatMode: "join-row",
    separator: " ",
    columns: "1,2",
    skipFirstRow: false,
    tagSource: "none",
    tagColumn: "",
};

const isStoredSeat = (value: unknown): value is StoredSeat => {
    if (!value || typeof value !== "object") return false;

    const seat = value as Partial<StoredSeat>;
    return (
        typeof seat.name === "string" &&
        Object.values(seatStatus).includes(seat.status as seatStatus) &&
        (seat.pinned === undefined || typeof seat.pinned === "boolean") &&
        (seat.tag === undefined || typeof seat.tag === "string")
    );
};

const normalizeStoredSeat = (seat: StoredSeat): Seat =>
    createSeat(
        seat.status,
        seat.name,
        seat.pinned === true,
        typeof seat.tag === "string" ? seat.tag : "",
    );

const loadSeatHistory = (): SeatHistoryEntry[] => {
    try {
        const storedHistory = JSON.parse(
            localStorage.getItem(HISTORY_STORAGE_KEY) ?? "[]",
        ) as unknown;

        if (!Array.isArray(storedHistory)) return [];

        return storedHistory
            .filter((entry): entry is StoredSeatHistoryEntry => {
                if (!entry || typeof entry !== "object") return false;

                const historyEntry = entry as Partial<StoredSeatHistoryEntry>;
                const { rowCount, colCount, seats } = historyEntry;
                return (
                    typeof historyEntry.id === "string" &&
                    typeof historyEntry.createdAt === "number" &&
                    typeof rowCount === "number" &&
                    Number.isInteger(rowCount) &&
                    rowCount > 0 &&
                    rowCount <= MAX_ROW_COUNT &&
                    typeof colCount === "number" &&
                    Number.isInteger(colCount) &&
                    colCount > 0 &&
                    colCount <= MAX_COL_COUNT &&
                    Array.isArray(seats) &&
                    seats.length === rowCount * colCount &&
                    seats.every(isStoredSeat)
                );
            })
            .map((entry) => ({
                ...entry,
                seats: entry.seats.map(normalizeStoredSeat),
                name:
                    typeof entry.name === "string" && entry.name.trim()
                        ? entry.name.trim()
                        : "未命名座位",
            }))
            .slice(0, MAX_HISTORY_COUNT);
    } catch {
        return [];
    }
};

const createHistoryEntry = (
    name: string,
    rowCount: number,
    colCount: number,
    seats: Seat[],
): SeatHistoryEntry => {
    const createdAt = Date.now();
    return {
        ...createSeatLayout(rowCount, colCount, seats),
        id: `${createdAt}-${Math.random().toString(36).slice(2)}`,
        name,
        createdAt,
    };
};

const persistSeatHistory = (history: SeatHistoryEntry[]) => {
    try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {
        // The in-memory history remains usable if local storage is unavailable.
    }
};

const parseImportTagColumn = (value: string) => {
    const trimmedValue = value.trim();
    if (!trimmedValue) return { column: null as number | null };

    const column = Number(trimmedValue);
    if (!Number.isInteger(column) || column < 1) return null;

    return { column };
};

const loadImportSettings = (): ImportSettings => {
    try {
        const storedSettings = JSON.parse(
            localStorage.getItem(IMPORT_SETTINGS_STORAGE_KEY) ?? "null",
        ) as unknown;

        if (!storedSettings || typeof storedSettings !== "object") {
            return DEFAULT_IMPORT_SETTINGS;
        }

        const settings = storedSettings as Partial<ImportSettings>;
        return {
            formatMode:
                settings.formatMode === "selected-columns" || settings.formatMode === "join-row"
                    ? settings.formatMode
                    : DEFAULT_IMPORT_SETTINGS.formatMode,
            separator:
                typeof settings.separator === "string"
                    ? settings.separator
                    : DEFAULT_IMPORT_SETTINGS.separator,
            columns:
                typeof settings.columns === "string"
                    ? settings.columns
                    : DEFAULT_IMPORT_SETTINGS.columns,
            skipFirstRow: settings.skipFirstRow === true,
            tagSource:
                settings.tagSource === "order" ||
                settings.tagSource === "column" ||
                settings.tagSource === "none"
                    ? settings.tagSource
                    : // 早期版本只存欄位編號，有值就當成指定欄位。
                      typeof settings.tagColumn === "string" && settings.tagColumn.trim()
                      ? "column"
                      : DEFAULT_IMPORT_SETTINGS.tagSource,
            tagColumn:
                typeof settings.tagColumn === "string"
                    ? settings.tagColumn
                    : DEFAULT_IMPORT_SETTINGS.tagColumn,
        };
    } catch {
        return DEFAULT_IMPORT_SETTINGS;
    }
};

const persistImportSettings = (settings: ImportSettings) => {
    try {
        localStorage.setItem(IMPORT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // 無法寫入 local storage 時，設定仍可在本次執行中使用。
    }
};

const parseImportColumns = (value: string) => {
    const tokens = value.split(/[,，\s]+/).filter(Boolean);
    if (tokens.length === 0) return null;

    const columns = tokens.map(Number);
    if (columns.some((column) => !Number.isInteger(column) || column < 1)) {
        return null;
    }

    return [...new Set(columns)];
};

const PinIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="seatPinMark">
        <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
    </svg>
);

export const SeatTable = () => {
    const [initialSeatHistory] = useState(loadSeatHistory);
    const [initialSeatLayout] = useState<SeatLayout>(() =>
        createSeatLayout(
            DEFAULT_ROW_COUNT,
            DEFAULT_COL_COUNT,
            createSeatList(DEFAULT_ROW_COUNT * DEFAULT_COL_COUNT),
        ),
    );
    const [rowCount, setRowCount] = useState(initialSeatLayout.rowCount);
    const [colCount, setColCount] = useState(initialSeatLayout.colCount);
    const [seatList, setSeatList] = useState<Seat[]>(() =>
        initialSeatLayout.seats.map((seat) => ({ ...seat })),
    );
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [isDeleteAllHistoryConfirming, setIsDeleteAllHistoryConfirming] = useState(false);
    const [seatHistory, setSeatHistory] = useState<SeatHistoryEntry[]>(initialSeatHistory);
    const [favoriteName, setFavoriteName] = useState("");
    const [isFavoriteDialogOpen, setIsFavoriteDialogOpen] = useState(false);
    const [operationNotice, setOperationNotice] = useState<OperationNotice | null>(null);
    const [isOperationNoticeVisible, setIsOperationNoticeVisible] = useState(false);
    const [undoStack, setUndoStack] = useState<SeatLayout[]>([]);
    const [redoStack, setRedoStack] = useState<SeatLayout[]>([]);
    const [initialImportSettings] = useState(loadImportSettings);
    const [importFormatMode, setImportFormatMode] = useState<ImportFormatMode>(
        initialImportSettings.formatMode,
    );
    const [importSeparator, setImportSeparator] = useState(initialImportSettings.separator);
    const [importColumns, setImportColumns] = useState(initialImportSettings.columns);
    const [importTagSource, setImportTagSource] = useState<ImportTagSource>(
        initialImportSettings.tagSource,
    );
    const [importTagColumn, setImportTagColumn] = useState(initialImportSettings.tagColumn);
    const [skipFirstRow, setSkipFirstRow] = useState(initialImportSettings.skipFirstRow);
    const [arrangeMode, setArrangeMode] = useState<ArrangeMode>("random");
    const [examPattern, setExamPattern] = useState<ExamPattern>("column-gap");
    const [examSeparateCategories, setExamSeparateCategories] = useState(true);
    const [numericOrder, setNumericOrder] = useState<NumericOrder>("asc");
    const [numericGrouping, setNumericGrouping] = useState<NumericGrouping>("row-major");
    const [randomizeWithinGroup, setRandomizeWithinGroup] = useState(true);
    const [exportTitle, setExportTitle] = useState("學生座位表");
    const [showExportPodium, setShowExportPodium] = useState(false);
    const [showExportIndex, setShowExportIndex] = useState(true);
    const [importSource, setImportSource] = useState<ImportSource | null>(null);
    const [isImportBusy, setIsImportBusy] = useState(false);
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");
    const [seatMenu, setSeatMenu] = useState<SeatMenuState | null>(null);
    const [renameSeatIndex, setRenameSeatIndex] = useState<number | null>(null);
    const [settleDelays, setSettleDelays] = useState<Record<number, number>>({});
    const [settleRun, setSettleRun] = useState(0);
    const settleTimerRef = useRef<number | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [renameTagValue, setRenameTagValue] = useState("");

    useEffect(() => {
        persistImportSettings({
            formatMode: importFormatMode,
            separator: importSeparator,
            columns: importColumns,
            skipFirstRow,
            tagSource: importTagSource,
            tagColumn: importTagColumn,
        });
    }, [
        importColumns,
        importFormatMode,
        importSeparator,
        importTagColumn,
        importTagSource,
        skipFirstRow,
    ]);

    const formatImportedRow = (row: unknown[]) => {
        const cells =
            importFormatMode === "selected-columns"
                ? (parseImportColumns(importColumns) ?? []).map((column) => row[column - 1])
                : row;

        return cells
            .map((cell) => String(cell ?? ""))
            .join(importSeparator)
            .trim();
    };

    const readImportedTag = (row: unknown[], order: number) => {
        if (importTagSource === "order") return String(order);
        if (importTagSource !== "column") return "";

        const parsedTagColumn = parseImportTagColumn(importTagColumn);
        if (!parsedTagColumn?.column) return "";

        return String(row[parsedTagColumn.column - 1] ?? "").trim();
    };

    /** 預覽與實際匯入共用同一條管線，畫面上看到的就是會匯入的名單。 */
    const buildImportStudents = (rows: unknown[][]): SeatStudent[] =>
        (skipFirstRow ? rows.slice(1) : rows)
            // 先濾掉空白列，名單順序才不會被空列佔號。
            .map((row) => ({ row, name: formatImportedRow(row) }))
            .filter((entry) => entry.name)
            .map((entry, index) => ({
                name: entry.name,
                tag: readImportedTag(entry.row, index + 1),
            }));

    const separatorDescription =
        importSeparator === ""
            ? "不分隔"
            : /^ +$/.test(importSeparator)
              ? `${importSeparator.length} 個空白`
              : `「${importSeparator}」`;

    const showOperationNotice = useCallback((message: string) => {
        // 每次都建立新物件，讓下方 effect 重新計時（同訊息連續觸發也會重新倒數）。
        setOperationNotice({ message });
        setIsOperationNoticeVisible(true);
    }, []);

    useEffect(() => {
        if (!operationNotice) return;

        const timeoutId = window.setTimeout(() => setIsOperationNoticeVisible(false), 2400);
        return () => window.clearTimeout(timeoutId);
    }, [operationNotice]);

    const replaceSeatLayout = useCallback((layout: SeatLayout) => {
        setRowCount(layout.rowCount);
        setColCount(layout.colCount);
        setSeatList(layout.seats.map((seat) => ({ ...seat })));
    }, []);

    const applySeatLayout = useCallback(
        (nextRowCount: number, nextColCount: number, nextSeats: Seat[]) => {
            const currentLayout = createSeatLayout(rowCount, colCount, seatList);
            const nextLayout = createSeatLayout(nextRowCount, nextColCount, nextSeats);

            setUndoStack((previousStack) =>
                [...previousStack, currentLayout].slice(-MAX_UNDO_COUNT),
            );
            setRedoStack([]);
            replaceSeatLayout(nextLayout);
        },
        [colCount, replaceSeatLayout, rowCount, seatList],
    );

    const undoSeatLayout = useCallback(() => {
        const previousLayout = undoStack.at(-1);
        if (!previousLayout) return;

        const currentLayout = createSeatLayout(rowCount, colCount, seatList);
        setUndoStack(undoStack.slice(0, -1));
        setRedoStack((previousStack) => [...previousStack, currentLayout].slice(-MAX_UNDO_COUNT));
        replaceSeatLayout(previousLayout);
        showOperationNotice("復原成功");
    }, [colCount, replaceSeatLayout, rowCount, seatList, showOperationNotice, undoStack]);

    const redoSeatLayout = useCallback(() => {
        const nextLayout = redoStack.at(-1);
        if (!nextLayout) return;

        const currentLayout = createSeatLayout(rowCount, colCount, seatList);
        setRedoStack(redoStack.slice(0, -1));
        setUndoStack((previousStack) => [...previousStack, currentLayout].slice(-MAX_UNDO_COUNT));
        replaceSeatLayout(nextLayout);
        showOperationNotice("重做成功");
    }, [colCount, redoStack, replaceSeatLayout, rowCount, seatList, showOperationNotice]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
            if (
                event.defaultPrevented ||
                !(event.ctrlKey || event.metaKey) ||
                event.altKey ||
                (target instanceof HTMLElement &&
                    (target.isContentEditable ||
                        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))
            ) {
                return;
            }

            const key = event.key.toLowerCase();
            if (key === "z" && !event.shiftKey && undoStack.length > 0) {
                event.preventDefault();
                undoSeatLayout();
            } else if (key === "y" && !event.shiftKey && redoStack.length > 0) {
                event.preventDefault();
                redoSeatLayout();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [redoSeatLayout, redoStack.length, undoSeatLayout, undoStack.length]);

    useEffect(() => {
        if (!seatMenu) return;

        const closeMenu = () => setSeatMenu(null);
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") closeMenu();
        };

        window.addEventListener("pointerdown", closeMenu);
        window.addEventListener("resize", closeMenu);
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("pointerdown", closeMenu);
            window.removeEventListener("resize", closeMenu);
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [seatMenu]);

    const saveSeatLayout = (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        const name = favoriteName.trim();
        if (!name) return;

        const historyEntry = createHistoryEntry(name, rowCount, colCount, seatList);
        setSeatHistory((previousHistory) => {
            const nextHistory = [historyEntry, ...previousHistory].slice(0, MAX_HISTORY_COUNT);
            persistSeatHistory(nextHistory);
            return nextHistory;
        });
        setFavoriteName("");
        setIsFavoriteDialogOpen(false);
        showOperationNotice(`已收藏「${name}」`);
    };

    const closeFavoriteDialog = () => {
        setFavoriteName("");
        setIsFavoriteDialogOpen(false);
    };

    const deleteSeatHistory = (historyEntry: SeatHistoryEntry) => {
        if (!confirm(`確定要刪除「${historyEntry.name}」嗎？`)) return;

        setSeatHistory((previousHistory) => {
            const nextHistory = previousHistory.filter((entry) => entry.id !== historyEntry.id);
            persistSeatHistory(nextHistory);
            return nextHistory;
        });
        showOperationNotice(`已刪除「${historyEntry.name}」`);
    };

    const deleteAllSeatHistory = () => {
        setSeatHistory([]);
        persistSeatHistory([]);
        setIsDeleteAllHistoryConfirming(false);
        showOperationNotice("已刪除全部座位紀錄");
    };

    const closeSeatHistory = () => {
        setIsHistoryOpen(false);
        setIsDeleteAllHistoryConfirming(false);
    };

    const restoreSeatLayout = (historyEntry: SeatHistoryEntry) => {
        applySeatLayout(historyEntry.rowCount, historyEntry.colCount, historyEntry.seats);
        closeSeatHistory();
        showOperationNotice(`已還原「${historyEntry.name}」`);
    };

    const addRow = () => {
        if (rowCount >= MAX_ROW_COUNT) return;
        applySeatLayout(rowCount + 1, colCount, [...seatList, ...createSeatList(colCount)]);
    };

    const removeRowAt = (row: Readonly<number>) => {
        if (rowCount <= 1 || row < 0 || row >= rowCount) return;

        const targetRowSeats = seatList.slice(row * colCount, (row + 1) * colCount);
        const hasAssignedSeat = targetRowSeats.some((seat) => seat.status === seatStatus.occ);
        if (hasAssignedSeat && !confirm(`第 ${row + 1} 列內有已分配學生的座位，確定要移除嗎？`)) {
            return;
        }

        applySeatLayout(rowCount - 1, colCount, [
            ...seatList.slice(0, row * colCount),
            ...seatList.slice((row + 1) * colCount),
        ]);
    };

    const addColumn = () => {
        if (colCount >= MAX_COL_COUNT) return;

        const nextSeats: Seat[] = [];
        for (let row = 0; row < rowCount; row++) {
            nextSeats.push(...seatList.slice(row * colCount, (row + 1) * colCount));
            nextSeats.push(createSeat());
        }
        applySeatLayout(rowCount, colCount + 1, nextSeats);
    };

    const removeColumnAt = (column: Readonly<number>) => {
        if (colCount <= 1 || column < 0 || column >= colCount) return;

        const targetColumnSeats = Array.from(
            { length: rowCount },
            (_, row) => seatList[row * colCount + column],
        );
        const hasAssignedSeat = targetColumnSeats.some((seat) => seat.status === seatStatus.occ);
        if (
            hasAssignedSeat &&
            !confirm(`第 ${column + 1} 欄內有已分配學生的座位，確定要移除嗎？`)
        ) {
            return;
        }

        const nextSeats: Seat[] = [];
        for (let row = 0; row < rowCount; row++) {
            for (let col = 0; col < colCount; col++) {
                if (col === column) continue;
                nextSeats.push(seatList[row * colCount + col]);
            }
        }
        applySeatLayout(rowCount, colCount - 1, nextSeats);
    };

    const changeSeatStatus = (
        i: Readonly<number>,
        status: Readonly<seatStatus>,
        text = "",
        pinned = false,
        tag = "",
    ) => {
        if (!seatList[i]) return;

        const nextSeats = [...seatList];
        nextSeats[i] = createSeat(status, text, pinned, tag);
        applySeatLayout(rowCount, colCount, nextSeats);
    };

    const clear = () => {
        applySeatLayout(rowCount, colCount, createSeatList(seatList.length));
    };

    /**
     * 系統的檔案選擇視窗是原生視窗，按下按鈕到視窗跳出中間會有明顯空檔，
     * 所以先把按鈕切成等待狀態給回饋，並趁空檔預先載入 xlsx 解析器。
     */
    const inputFile = () => {
        if (isImportBusy) return;

        setIsImportBusy(true);
        void import("xlsx");

        const input = document.createElement("input");
        input.accept = ".xlsx";
        input.type = "file";
        let hasPickedFile = false;
        input.onchange = () => {
            hasPickedFile = true;
            const file = input.files?.[0];
            if (file) {
                readWorkbook(file);
            } else {
                setIsImportBusy(false);
            }
        };
        // 使用者直接關掉檔案視窗時 change 不會觸發，等視窗重新取得焦點再解鎖按鈕。
        window.addEventListener(
            "focus",
            () => {
                window.setTimeout(() => {
                    if (!hasPickedFile) setIsImportBusy(false);
                }, 300);
            },
            { once: true },
        );
        input.click();
    };

    /** 回傳實際填入學生的座位索引（依填入順序），容量不足時回傳 null。 */
    const importData = (students: SeatStudent[]) => {
        const capacity = seatList.reduce(
            (count, seat) => count + Number(seat.status === seatStatus.ava),
            0,
        );

        if (students.length > capacity) {
            alert("學生數量大於座位數量! 請調整座位數量。");
            return null;
        }

        const shuffledSeatIndexes = shuffle(seatList.map((_, seatIndex) => seatIndex));
        const nextSeats = seatList.map((seat) =>
            createSeat(seat.status === seatStatus.emp ? seatStatus.emp : seatStatus.ava),
        );
        const filledSeatIndexes: number[] = [];
        let studentIndex = 0;

        for (const seatIndex of shuffledSeatIndexes) {
            if (studentIndex < students.length && seatList[seatIndex].status === seatStatus.ava) {
                nextSeats[seatIndex] = createSeat(
                    seatStatus.occ,
                    students[studentIndex].name,
                    false,
                    students[studentIndex].tag,
                );
                filledSeatIndexes.push(seatIndex);
                studentIndex++;
            }
        }

        applySeatLayout(rowCount, colCount, nextSeats);
        return filledSeatIndexes;
    };

    const clearSettleTimer = useCallback(() => {
        if (settleTimerRef.current === null) return;

        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
    }, []);

    useEffect(() => clearSettleTimer, [clearSettleTimer]);

    /** 讓剛填入學生的座位依序彈跳，delay 形成波浪效果。 */
    const playSettleAnimation = useCallback(
        (orderedSeatIndexes: number[]) => {
            if (orderedSeatIndexes.length === 0) return;
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

            const step = Math.min(
                SEAT_SETTLE_STEP,
                SEAT_SETTLE_MAX_DELAY / Math.max(orderedSeatIndexes.length - 1, 1),
            );
            const nextSettleDelays: Record<number, number> = {};
            let lastDelay = 0;

            orderedSeatIndexes.forEach((seatIndex, position) => {
                lastDelay = Math.round(position * step);
                nextSettleDelays[seatIndex] = lastDelay;
            });

            clearSettleTimer();
            setSettleRun((previousRun) => previousRun + 1);
            setSettleDelays(nextSettleDelays);
            settleTimerRef.current = window.setTimeout(
                () => {
                    settleTimerRef.current = null;
                    setSettleDelays({});
                },
                lastDelay + SEAT_SETTLE_DURATION + 80,
            );
        },
        [clearSettleTimer],
    );

    const describePinnedSeats = () => {
        const pinnedCount = seatList.reduce(
            (count, seat) => count + Number(seat.status === seatStatus.occ && seat.pinned),
            0,
        );

        return pinnedCount > 0 ? `，保留 ${pinnedCount} 個釘選座位` : "";
    };

    const reshuffleSeats = () => {
        const movableStudents: SeatStudent[] = [];
        const targetIndexes: number[] = [];

        seatList.forEach((seat, seatIndex) => {
            if (seat.status === seatStatus.occ) {
                if (seat.pinned) return;
                movableStudents.push({ name: seat.name, tag: seat.tag });
                targetIndexes.push(seatIndex);
            } else if (seat.status === seatStatus.ava) {
                targetIndexes.push(seatIndex);
            }
        });

        if (movableStudents.length === 0) {
            alert("目前沒有可重抽的學生，請先匯入學生或取消釘選座位。");
            return;
        }

        if (targetIndexes.length < 2) {
            alert("可重抽的座位不足，至少需要兩個未釘選的座位。");
            return;
        }

        // 以空位補滿其餘可分配座位，讓學生能被隨機抽到任何一個未釘選的位置。
        const blanks = Array.from(
            { length: targetIndexes.length - movableStudents.length },
            () => null,
        );
        const previousNames = targetIndexes.map((seatIndex) => seatList[seatIndex].name);

        let nextStudents = shuffle<SeatStudent | null>([...movableStudents, ...blanks]);
        for (
            let attempt = 0;
            attempt < MAX_RESHUFFLE_ATTEMPT &&
            nextStudents.every(
                (student, position) => (student?.name ?? "") === previousNames[position],
            );
            attempt++
        ) {
            nextStudents = shuffle<SeatStudent | null>([...movableStudents, ...blanks]);
        }

        const nextSeats = [...seatList];
        const settleOrder: number[] = [];
        targetIndexes.forEach((seatIndex, position) => {
            const student = nextStudents[position];
            nextSeats[seatIndex] = student
                ? createSeat(seatStatus.occ, student.name, false, student.tag)
                : createSeat(seatStatus.ava);
            if (student) settleOrder.push(seatIndex);
        });

        applySeatLayout(rowCount, colCount, nextSeats);
        showOperationNotice(`已再抽一次${describePinnedSeats()}`);
        playSettleAnimation(settleOrder);
    };

    const applyArrangement = () => {
        if (arrangeMode === "random") {
            reshuffleSeats();
            return;
        }

        const result = arrangeSeats(
            { rowCount, colCount, seats: seatList },
            {
                mode: arrangeMode,
                examPattern,
                examSeparateCategories,
                numericOrder,
                numericGrouping,
                randomizeWithinGroup,
            },
        );

        if (!result.ok) {
            alert(result.error);
            return;
        }

        applySeatLayout(rowCount, colCount, result.seats);
        showOperationNotice(
            `已套用「${ARRANGE_MODE_LABELS[arrangeMode]}」${describePinnedSeats()}`,
        );
        playSettleAnimation(result.filledOrder);
    };

    const exportExcel = async () => {
        const seats: string[][] = [];
        for (let i = 0; i < rowCount; i++) {
            seats.push([]);
            for (let j = 0; j < colCount; j++) {
                seats[i].push(seatList[i * colCount + j].name);
            }
        }

        try {
            const [XLSX, { saveAs }] = await Promise.all([import("xlsx"), import("file-saver")]);
            const workbook = XLSX.utils.book_new();
            const worksheet = XLSX.utils.aoa_to_sheet(seats);
            XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

            const workbookData = XLSX.write(workbook, {
                bookType: "xlsx",
                type: "array",
            });
            const blob = new Blob([workbookData], {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            });
            saveAs(blob, "學生座位表.xlsx");
        } catch {
            alert("匯出座位表失敗，請稍後再試。");
        }
    };

    const exportImage = async () => {
        try {
            await exportSeatLayoutAsPng(
                { rowCount, colCount, seats: seatList },
                {
                    title: exportTitle,
                    showPodium: showExportPodium,
                    showIndex: showExportIndex,
                },
            );
            showOperationNotice("已匯出 PNG 圖片");
        } catch {
            alert("匯出 PNG 圖片失敗，請稍後再試。");
        }
    };

    const exportPdf = async () => {
        try {
            await exportSeatLayoutAsPdf(
                { rowCount, colCount, seats: seatList },
                {
                    title: exportTitle,
                    showPodium: showExportPodium,
                    showIndex: showExportIndex,
                },
            );
            showOperationNotice("已匯出 PDF");
        } catch {
            alert("匯出 PDF 失敗，請稍後再試。");
        }
    };

    const confirmExport = () => {
        setIsExportDialogOpen(false);

        if (exportFormat === "xlsx") {
            void exportExcel();
        } else if (exportFormat === "pdf") {
            void exportPdf();
        } else if (exportFormat === "png") {
            void exportImage();
        }
    };

    const toggleSeatStatus = (index: number) => {
        if (seatList[index].status === seatStatus.ava) changeSeatStatus(index, seatStatus.emp);
        else if (seatList[index].status === seatStatus.emp) changeSeatStatus(index, seatStatus.ava);
    };

    const closeSeatMenu = () => setSeatMenu(null);

    const openSeatMenu = (event: MouseEvent<HTMLDivElement>, seatIndex: number) => {
        event.preventDefault();
        const seat = seatList[seatIndex];
        if (!seat) return;

        const itemCount =
            seat.status === seatStatus.emp ? 1 : seat.status === seatStatus.occ ? 3 : 2;
        const menuHeight = itemCount * SEAT_MENU_ITEM_HEIGHT + SEAT_MENU_PADDING;
        setSeatMenu({
            index: seatIndex,
            x: Math.max(8, Math.min(event.clientX, window.innerWidth - SEAT_MENU_WIDTH - 8)),
            y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
        });
    };

    const openSeatRename = (seatIndex: number) => {
        const seat = seatList[seatIndex];
        if (!seat || seat.status === seatStatus.emp) return;

        closeSeatMenu();
        setRenameSeatIndex(seatIndex);
        setRenameValue(seat.name);
        setRenameTagValue(seat.tag);
    };

    const closeSeatRename = () => setRenameSeatIndex(null);

    const submitSeatRename = (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (renameSeatIndex === null) return;

        const name = renameValue.trim();
        changeSeatStatus(
            renameSeatIndex,
            name ? seatStatus.occ : seatStatus.ava,
            name,
            seatList[renameSeatIndex].pinned,
            renameTagValue.trim(),
        );
        setRenameSeatIndex(null);
        showOperationNotice(name ? `已改為「${name}」` : "已清空座位文字");
    };

    const removeSeatStudent = (seatIndex: number) => {
        const seat = seatList[seatIndex];
        if (!seat || seat.status !== seatStatus.occ) return;

        closeSeatMenu();
        if (!confirm(`確定要刪除「${seat.name}」嗎？`)) return;

        changeSeatStatus(seatIndex, seatStatus.ava);
        showOperationNotice(`已刪除「${seat.name}」`);
    };

    const toggleSeatPin = (seatIndex: number) => {
        const seat = seatList[seatIndex];
        if (!seat || seat.status !== seatStatus.occ) return;

        closeSeatMenu();
        changeSeatStatus(seatIndex, seatStatus.occ, seat.name, !seat.pinned, seat.tag);
        showOperationNotice(seat.pinned ? `已取消釘選「${seat.name}」` : `已釘選「${seat.name}」`);
    };

    const toggleSeatStatusFromMenu = (seatIndex: number) => {
        closeSeatMenu();
        toggleSeatStatus(seatIndex);
    };

    const exchange = (sourceID: number, targetID: number) => {
        if (!Number.isInteger(sourceID) || sourceID === targetID) return;

        if (!seatList[sourceID] || !seatList[targetID]) return;

        const nextSeats = [...seatList];
        [nextSeats[sourceID], nextSeats[targetID]] = [nextSeats[targetID], nextSeats[sourceID]];
        applySeatLayout(rowCount, colCount, nextSeats);
        playSettleAnimation([sourceID, targetID]);
    };

    const exchangeRows = (sourceRow: number, targetRow: number) => {
        if (!Number.isInteger(sourceRow) || sourceRow === targetRow) return;
        if (sourceRow < 0 || sourceRow >= rowCount) return;
        if (targetRow < 0 || targetRow >= rowCount) return;

        const nextSeats = [...seatList];
        const settleOrder: number[] = [];
        for (let col = 0; col < colCount; col++) {
            const sourceIndex = sourceRow * colCount + col;
            const targetIndex = targetRow * colCount + col;
            [nextSeats[sourceIndex], nextSeats[targetIndex]] = [
                nextSeats[targetIndex],
                nextSeats[sourceIndex],
            ];
            settleOrder.push(sourceIndex, targetIndex);
        }
        applySeatLayout(rowCount, colCount, nextSeats);
        showOperationNotice(`已交換第 ${sourceRow + 1} 列與第 ${targetRow + 1} 列`);
        playSettleAnimation(settleOrder);
    };

    const exchangeColumns = (sourceColumn: number, targetColumn: number) => {
        if (!Number.isInteger(sourceColumn) || sourceColumn === targetColumn) return;
        if (sourceColumn < 0 || sourceColumn >= colCount) return;
        if (targetColumn < 0 || targetColumn >= colCount) return;

        const nextSeats = [...seatList];
        const settleOrder: number[] = [];
        for (let row = 0; row < rowCount; row++) {
            const sourceIndex = row * colCount + sourceColumn;
            const targetIndex = row * colCount + targetColumn;
            [nextSeats[sourceIndex], nextSeats[targetIndex]] = [
                nextSeats[targetIndex],
                nextSeats[sourceIndex],
            ];
            settleOrder.push(sourceIndex, targetIndex);
        }
        applySeatLayout(rowCount, colCount, nextSeats);
        showOperationNotice(`已交換第 ${sourceColumn + 1} 欄與第 ${targetColumn + 1} 欄`);
        playSettleAnimation(settleOrder);
    };

    /** 只負責把檔案讀成工作表資料並開啟預覽視窗，實際套用交給預覽視窗確認。 */
    const readWorkbook = (file: File) => {
        const reader = new FileReader();
        reader.onload = async (event) => {
            if (!(event.target?.result instanceof ArrayBuffer)) {
                setIsImportBusy(false);
                return;
            }

            try {
                const XLSX = await import("xlsx");
                const workbook = XLSX.read(event.target.result, { type: "array" });
                // 名單檔案不大，一次全部解析好，切換工作表就不必留著 workbook。
                const sheets = workbook.SheetNames.map((name) => ({
                    name,
                    rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
                        header: 1,
                    }),
                })).filter((sheet) => sheet.rows.length > 0);

                if (sheets.length === 0) {
                    alert("Excel 檔案中沒有可讀取的工作表。");
                    return;
                }

                setImportSource({
                    fileName: file.name,
                    sheets,
                    sheetName: sheets[0].name,
                });
            } catch {
                alert("無法讀取 Excel 檔案，請確認檔案格式是否正確。");
            } finally {
                setIsImportBusy(false);
            }
        };
        reader.onerror = () => {
            setIsImportBusy(false);
            alert("無法讀取選取的檔案。");
        };
        reader.readAsArrayBuffer(file);
    };

    const handleSeatDragOver = (event: DragEvent<HTMLDivElement>) => {
        if (!event.dataTransfer.types.includes(SEAT_DRAG_TYPE)) return;

        event.preventDefault();
        event.currentTarget.classList.add("border-dashed", "opacity-50");
    };

    const handleSeatDragStart = (event: DragEvent<HTMLDivElement>, seatIndex: number) => {
        event.dataTransfer.setData(SEAT_DRAG_TYPE, String(seatIndex));
        event.dataTransfer.effectAllowed = "move";
        event.currentTarget.classList.add("border-status-dim");
    };

    const handleSeatDrop = (event: DragEvent<HTMLDivElement>, targetIndex: number) => {
        event.preventDefault();
        event.currentTarget.classList.remove("border-dashed", "opacity-50");
        const sourceID = event.dataTransfer.getData(SEAT_DRAG_TYPE);
        if (!sourceID) return;

        event.stopPropagation();
        exchange(Number(sourceID), targetIndex);
    };

    const handleHeaderDragStart = (
        event: DragEvent<HTMLDivElement>,
        dragType: string,
        index: number,
    ) => {
        event.dataTransfer.setData(dragType, String(index));
        event.dataTransfer.effectAllowed = "move";
        event.currentTarget.classList.add("seatHeaderDragging");
    };

    const handleHeaderDragOver = (event: DragEvent<HTMLDivElement>, dragType: string) => {
        // 只接受同一軸向的整列／整欄拖曳，避免座位或檔案拖曳誤觸。
        if (!event.dataTransfer.types.includes(dragType)) return;

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        event.currentTarget.classList.add("seatHeaderDropTarget");
    };

    const handleHeaderDrop = (
        event: DragEvent<HTMLDivElement>,
        dragType: string,
        targetIndex: number,
    ) => {
        event.currentTarget.classList.remove("seatHeaderDropTarget");
        const sourceIndex = event.dataTransfer.getData(dragType);
        if (!sourceIndex) return;

        event.preventDefault();
        event.stopPropagation();
        if (dragType === ROW_DRAG_TYPE) {
            exchangeRows(Number(sourceIndex), targetIndex);
        } else {
            exchangeColumns(Number(sourceIndex), targetIndex);
        }
    };

    const dropFile = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(".xlsx")) {
            alert("僅支援 xlsx 檔!");
            return;
        }

        readWorkbook(file);
    };

    const seatCounts = seatList.reduce(
        (counts, seat) => {
            counts[seat.status]++;
            return counts;
        },
        {
            [seatStatus.ava]: 0,
            [seatStatus.occ]: 0,
            [seatStatus.emp]: 0,
        },
    );
    const hasSeatChanges = seatCounts[seatStatus.ava] !== seatList.length;
    const pinnedSeatCount = seatList.reduce(
        (count, seat) => count + Number(seat.status === seatStatus.occ && seat.pinned),
        0,
    );
    const movableStudentCount = seatCounts[seatStatus.occ] - pinnedSeatCount;
    const taggedStudentCount = seatList.reduce(
        (count, seat) => count + Number(seat.status === seatStatus.occ && seat.tag.trim() !== ""),
        0,
    );
    const needsTagData = arrangeMode === "category" || arrangeMode === "numeric";
    const isArrangeBlocked =
        movableStudentCount === 0 || (needsTagData && taggedStudentCount === 0);
    const arrangeHint = ARRANGE_MODE_HINTS[arrangeMode];

    const activeImportSheet =
        importSource?.sheets.find((sheet) => sheet.name === importSource.sheetName) ?? null;
    const importRows = activeImportSheet?.rows ?? [];
    const importStudents = buildImportStudents(importRows);
    const importPreviewRows = importRows.slice(0, MAX_IMPORT_PREVIEW_ROW);
    const importPreviewColumns = Array.from(
        {
            length: Math.min(
                importRows.reduce((count, row) => Math.max(count, row.length), 0),
                MAX_IMPORT_PREVIEW_COLUMN,
            ),
        },
        (_, index) => index + 1,
    );
    /** 預覽列的實際結果，order 必須跟真正匯入時的編號一致。 */
    const importPreviewEntries = importPreviewRows.reduce<
        { row: unknown[]; skipped: boolean; name: string; tag: string }[]
    >((entries, row, rowIndex) => {
        const skipped = skipFirstRow && rowIndex === 0;
        const name = skipped ? "" : formatImportedRow(row);
        const order = entries.filter((entry) => entry.name).length + 1;

        entries.push({
            row,
            skipped,
            name,
            tag: name ? readImportedTag(row, order) : "",
        });
        return entries;
    }, []);
    const importSelectedColumns =
        importFormatMode === "selected-columns" ? (parseImportColumns(importColumns) ?? []) : [];
    const importTagColumnNumber =
        importTagSource === "column"
            ? (parseImportTagColumn(importTagColumn)?.column ?? null)
            : null;

    const describeImportIssue = () => {
        if (!activeImportSheet) return null;
        if (importFormatMode === "selected-columns" && !parseImportColumns(importColumns)) {
            return "請輸入有效的欄位編號，例如 1,2,4。";
        }
        if (importTagSource === "column" && !parseImportTagColumn(importTagColumn)) {
            return "排序依據欄位請輸入單一欄位編號，例如 3。";
        }
        if (importStudents.length === 0) {
            return "這個設定讀不到任何學生，請調整顯示欄位或略過第一列的設定。";
        }
        if (importStudents.length > seatCounts[seatStatus.ava]) {
            return `學生 ${importStudents.length} 人超過可分配座位 ${
                seatCounts[seatStatus.ava]
            } 個，請先增加座位或清空座位。`;
        }

        return null;
    };
    const importIssue = describeImportIssue();

    /** 點欄位標題就等於勾選「顯示欄位」，合併整列模式會自動切成組合指定欄位。 */
    const toggleImportColumn = (column: number) => {
        const nextColumns = importSelectedColumns.includes(column)
            ? importSelectedColumns.filter((selected) => selected !== column)
            : [...importSelectedColumns, column];

        // 新選的欄位接在最後，保留使用者自己排的組合順序。
        setImportFormatMode("selected-columns");
        setImportColumns(nextColumns.join(","));
    };

    const toggleImportTagColumn = (column: number) => {
        setImportTagColumn(importTagColumnNumber === column ? "" : String(column));
    };

    const confirmImportStudents = () => {
        if (importIssue) return;

        const filledSeatIndexes = importData(importStudents);
        if (!filledSeatIndexes) return;

        setImportSource(null);
        showOperationNotice(`已匯入 ${importStudents.length} 位學生`);
        playSettleAnimation(filledSeatIndexes);
    };

    const seatMenuTarget = seatMenu ? seatList[seatMenu.index] : undefined;
    const renameSeatLabel =
        renameSeatIndex === null
            ? ""
            : `第 ${Math.floor(renameSeatIndex / colCount) + 1} 列第 ${
                  (renameSeatIndex % colCount) + 1
              } 欄`;

    return (
        <>
            <div className="flex min-h-0 flex-1 gap-4 px-6 py-4">
                <aside className="sidebarPanel">
                    {/* 與右側標題列同高，兩邊標題才會對齊。 */}
                    <div className="flex min-h-10 shrink-0 items-center">
                        <p className="select-none text-[14px] font-medium leading-[130%] text-[#EDF0F4]">
                            座位排序
                        </p>
                    </div>

                    <section aria-label="座位排序" className="panelCard">
                        <div className="flex flex-col gap-3">
                            <div className="min-w-0">
                                <p className="hintText">{arrangeHint}</p>
                                <p className="mt-1 hintText">
                                    可重排 {movableStudentCount} 人 · 已釘選 {pinnedSeatCount}{" "}
                                    個座位 · 有排序依據 {taggedStudentCount} 人
                                </p>
                                {needsTagData && taggedStudentCount === 0 && (
                                    <p className="mt-1 select-none text-[11px] text-red-400">
                                        這個排序方式需要排序依據資料，請在匯入的預覽視窗指定排序依據欄位後重新匯入。
                                    </p>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={applyArrangement}
                                disabled={isArrangeBlocked}
                                className="functionalButton basicButtonAnimation w-full border-fuchsia-400 hover:bg-fuchsia-400/10 disabled:border-[#596178] disabled:text-[#6F778A]"
                            >
                                {arrangeMode === "random" ? "再抽一次" : "套用排序"}
                            </button>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-3">
                            <label className="block">
                                <span className="fieldLabel">排序方式</span>
                                <select
                                    value={arrangeMode}
                                    onChange={(event) =>
                                        setArrangeMode(event.target.value as ArrangeMode)
                                    }
                                    className="selectField bg-[#141828]"
                                >
                                    {(Object.keys(ARRANGE_MODE_LABELS) as ArrangeMode[]).map(
                                        (mode) => (
                                            <option key={mode} value={mode}>
                                                {ARRANGE_MODE_LABELS[mode]}
                                            </option>
                                        ),
                                    )}
                                </select>
                            </label>

                            {arrangeMode === "exam" && (
                                <div className="block">
                                    <div className="fieldLabelRow">
                                        <label className="fieldLabel" htmlFor="examPattern">
                                            座位圖樣
                                        </label>
                                        <label className="flex cursor-pointer items-center gap-1.5">
                                            <input
                                                type="checkbox"
                                                checked={examSeparateCategories}
                                                onChange={(event) =>
                                                    setExamSeparateCategories(event.target.checked)
                                                }
                                                className="checkboxField"
                                            />
                                            <span className="hintText">避開同類別</span>
                                        </label>
                                    </div>
                                    <select
                                        id="examPattern"
                                        value={examPattern}
                                        onChange={(event) =>
                                            setExamPattern(event.target.value as ExamPattern)
                                        }
                                        className="selectField bg-[#141828]"
                                    >
                                        {(Object.keys(EXAM_PATTERN_LABELS) as ExamPattern[]).map(
                                            (pattern) => (
                                                <option key={pattern} value={pattern}>
                                                    {EXAM_PATTERN_LABELS[pattern]}
                                                </option>
                                            ),
                                        )}
                                    </select>
                                    <span className="formHint hintText">
                                        沒被選到的座位會改為停用；勾選「避開同類別」會依排序依據讓相鄰座位盡量落在不同類別。
                                    </span>
                                </div>
                            )}

                            {arrangeMode === "numeric" && (
                                <>
                                    <label className="block">
                                        <span className="fieldLabel">數值順序</span>
                                        <select
                                            value={numericOrder}
                                            onChange={(event) =>
                                                setNumericOrder(event.target.value as NumericOrder)
                                            }
                                            className="selectField bg-[#141828]"
                                        >
                                            {(
                                                Object.keys(NUMERIC_ORDER_LABELS) as NumericOrder[]
                                            ).map((order) => (
                                                <option key={order} value={order}>
                                                    {NUMERIC_ORDER_LABELS[order]}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label className="block">
                                        <span className="fieldLabel">填入方式</span>
                                        <select
                                            value={numericGrouping}
                                            onChange={(event) =>
                                                setNumericGrouping(
                                                    event.target.value as NumericGrouping,
                                                )
                                            }
                                            className="selectField bg-[#141828]"
                                        >
                                            {(
                                                Object.keys(
                                                    NUMERIC_GROUPING_LABELS,
                                                ) as NumericGrouping[]
                                            ).map((grouping) => (
                                                <option key={grouping} value={grouping}>
                                                    {NUMERIC_GROUPING_LABELS[grouping]}
                                                </option>
                                            ))}
                                        </select>
                                        {numericOrder === "balanced" && (
                                            <span className="formHint hintText">
                                                平均分配會把學生依數值切成「每群座位數」個區段，每一列／排／區塊各取一位，讓每群的高低分佈平均。
                                            </span>
                                        )}
                                    </label>
                                </>
                            )}

                            {arrangeMode !== "random" && (
                                <label className="optionCard cursor-pointer bg-[#141828]">
                                    <input
                                        type="checkbox"
                                        checked={randomizeWithinGroup}
                                        onChange={(event) =>
                                            setRandomizeWithinGroup(event.target.checked)
                                        }
                                        className="checkboxField"
                                    />
                                    <span>
                                        <span className="optionTitle">群內隨機排序</span>
                                        <span className="block hintText">
                                            {arrangeMode === "numeric"
                                                ? numericOrder === "balanced"
                                                    ? "每個高低區段隨機挑一位分到同一群；取消勾選則照固定的蛇形順序分配。"
                                                    : "同一列／排／區塊內的學生順序隨機打亂，群與群之間仍照數值大小。"
                                                : arrangeMode === "exam" && !examSeparateCategories
                                                  ? "所有學生的順序隨機打亂；取消勾選則照匯入名單的順序填入座位。"
                                                  : "同一類別內的學生順序隨機打亂；取消勾選則照匯入名單的順序。"}
                                        </span>
                                    </span>
                                </label>
                            )}
                        </div>
                    </section>

                    <section aria-label="座位收藏與紀錄" className="panelCard">
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setIsFavoriteDialogOpen(true)}
                                className="functionalButton basicButtonAnimation min-w-0 flex-1 px-3 whitespace-nowrap border-fuchsia-400 hover:bg-fuchsia-400/10"
                            >
                                ☆ 收藏
                            </button>

                            <button
                                type="button"
                                onClick={() => setIsHistoryOpen(true)}
                                className="functionalButton basicButtonAnimation min-w-0 flex-1 px-3 whitespace-nowrap border-[#596178] bg-[#23283D] text-[#EDF0F4] hover:border-fuchsia-400 hover:text-fuchsia-400"
                            >
                                座位紀錄（{seatHistory.length}）
                            </button>
                        </div>
                    </section>
                </aside>

                <main className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <p className="select-none text-[14px] font-medium leading-[130%] text-[#EDF0F4]">
                            學生座位預覽
                        </p>

                        {/* Button */}
                        <div className="flex flex-wrap gap-2">
                            <button
                                className="functionalButton basicButtonAnimation whitespace-nowrap"
                                onClick={inputFile}
                                disabled={isImportBusy}
                            >
                                {isImportBusy ? "開啟中…" : "匯入學生"}
                            </button>
                            <button
                                onClick={() => setIsExportDialogOpen(true)}
                                disabled={!hasSeatChanges}
                                className="functionalButton basicButtonAnimation whitespace-nowrap"
                            >
                                匯出座位
                            </button>
                            <button
                                className="functionalButton basicButtonAnimation whitespace-nowrap"
                                onClick={clear}
                                disabled={!hasSeatChanges}
                            >
                                清空座位
                            </button>
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-auto">
                        <div
                            onDrop={dropFile}
                            onDragOver={(e) => {
                                e.preventDefault();
                            }}
                            className="seatGrid"
                            style={{
                                gridTemplateColumns: `auto repeat(${colCount}, minmax(0, 1fr)) auto`,
                                // 一般列數時 1fr 讓座位長高填滿右欄，列數很多時退回最小高度並由外層捲動。
                                gridTemplateRows: `auto repeat(${rowCount}, minmax(2rem, 1fr)) auto`,
                            }}
                        >
                            <div />
                            <div
                                className="flex justify-center"
                                style={{ gridColumn: `span ${colCount}` }}
                            >
                                <div className="podiumBadge">講臺</div>
                            </div>
                            <div />

                            {Array.from({ length: rowCount }, (_, row) => (
                                <Fragment key={`row-${row}`}>
                                    <div
                                        className={
                                            "seatHeaderCell group min-w-12" +
                                            (rowCount > 1 ? " seatHeaderDraggable" : "")
                                        }
                                        draggable={rowCount > 1}
                                        title={rowCount > 1 ? "拖曳列號可與其他列互換" : undefined}
                                        onDragStart={(event) =>
                                            handleHeaderDragStart(event, ROW_DRAG_TYPE, row)
                                        }
                                        onDragOver={(event) =>
                                            handleHeaderDragOver(event, ROW_DRAG_TYPE)
                                        }
                                        onDragLeave={(event) =>
                                            event.currentTarget.classList.remove(
                                                "seatHeaderDropTarget",
                                            )
                                        }
                                        onDragEnd={(event) =>
                                            event.currentTarget.classList.remove(
                                                "seatHeaderDragging",
                                            )
                                        }
                                        onDrop={(event) =>
                                            handleHeaderDrop(event, ROW_DRAG_TYPE, row)
                                        }
                                    >
                                        {/* 與刪除鈕等寬的佔位，數字才會落在格子正中央。 */}
                                        <span aria-hidden className="size-4 shrink-0" />
                                        <span>{row + 1}</span>
                                        <button
                                            type="button"
                                            onClick={() => removeRowAt(row)}
                                            disabled={rowCount <= 1}
                                            title={`移除第 ${row + 1} 列`}
                                            aria-label={`移除第 ${row + 1} 列`}
                                            className="seatHeaderDelete"
                                        >
                                            ×
                                        </button>
                                    </div>
                                    {seatList
                                        .slice(row * colCount, row * colCount + colCount)
                                        .map((seat, col) => {
                                            const i = row * colCount + col;
                                            const settleDelay = settleDelays[i];
                                            return (
                                                <div
                                                    draggable
                                                    className={
                                                        seat.status +
                                                        " basicSeat" +
                                                        (settleDelay === undefined
                                                            ? ""
                                                            : " seatSettling")
                                                    }
                                                    style={
                                                        settleDelay === undefined
                                                            ? undefined
                                                            : { animationDelay: `${settleDelay}ms` }
                                                    }
                                                    title={
                                                        seat.pinned
                                                            ? "已釘選，再抽一次時不會移動"
                                                            : undefined
                                                    }
                                                    key={
                                                        settleDelay === undefined
                                                            ? String(i)
                                                            : `${i}-settle-${settleRun}`
                                                    }
                                                    onClick={() => toggleSeatStatus(i)}
                                                    onContextMenu={(event) =>
                                                        openSeatMenu(event, i)
                                                    }
                                                    onDragStart={(event) =>
                                                        handleSeatDragStart(event, i)
                                                    }
                                                    onDragOver={handleSeatDragOver}
                                                    onDragLeave={(event) =>
                                                        event.currentTarget.classList.remove(
                                                            "border-dashed",
                                                            "opacity-50",
                                                        )
                                                    }
                                                    onDragEnd={(event) =>
                                                        event.currentTarget.classList.remove(
                                                            "border-status-dim",
                                                        )
                                                    }
                                                    onDrop={(event) => handleSeatDrop(event, i)}
                                                >
                                                    {seat.pinned && <PinIcon />}
                                                    {seat.name}
                                                    {seat.tag && (
                                                        <span className="seatTag">{seat.tag}</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    <div />
                                </Fragment>
                            ))}

                            <div className="flex items-center justify-center">
                                <button
                                    type="button"
                                    onClick={addRow}
                                    disabled={rowCount >= MAX_ROW_COUNT}
                                    title="新增一列"
                                    aria-label="新增一列"
                                    className="h-7 px-1.5 text-[11px] functionalButton basicButtonAnimation"
                                >
                                    ＋
                                </button>
                            </div>
                            {Array.from({ length: colCount }, (_, col) => (
                                <div
                                    key={`colHeader-${col}`}
                                    className={
                                        "seatHeaderCell group" +
                                        (colCount > 1 ? " seatHeaderDraggable" : "")
                                    }
                                    draggable={colCount > 1}
                                    title={colCount > 1 ? "拖曳欄號可與其他欄互換" : undefined}
                                    onDragStart={(event) =>
                                        handleHeaderDragStart(event, COLUMN_DRAG_TYPE, col)
                                    }
                                    onDragOver={(event) =>
                                        handleHeaderDragOver(event, COLUMN_DRAG_TYPE)
                                    }
                                    onDragLeave={(event) =>
                                        event.currentTarget.classList.remove("seatHeaderDropTarget")
                                    }
                                    onDragEnd={(event) =>
                                        event.currentTarget.classList.remove("seatHeaderDragging")
                                    }
                                    onDrop={(event) =>
                                        handleHeaderDrop(event, COLUMN_DRAG_TYPE, col)
                                    }
                                >
                                    {/* 與刪除鈕等寬的佔位，數字才會落在格子正中央。 */}
                                    <span aria-hidden className="size-4 shrink-0" />
                                    <span>{col + 1}</span>
                                    <button
                                        type="button"
                                        onClick={() => removeColumnAt(col)}
                                        disabled={colCount <= 1}
                                        title={`移除第 ${col + 1} 欄`}
                                        aria-label={`移除第 ${col + 1} 欄`}
                                        className="seatHeaderDelete"
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                            <div className="flex items-center justify-center">
                                <button
                                    type="button"
                                    onClick={addColumn}
                                    disabled={colCount >= MAX_COL_COUNT}
                                    title="新增一欄"
                                    aria-label="新增一欄"
                                    className="h-7 px-1.5 text-[11px] functionalButton basicButtonAnimation"
                                >
                                    ＋
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <p className="hintText leading-[150%]">
                            左鍵切換座位狀態，右鍵可修改文字、釘選或刪除學生。Ctrl + Z
                            可以復原、Ctrl + Y 可以重做。
                        </p>

                        <StatusBar
                            occupiedCount={seatCounts[seatStatus.occ]}
                            availableCount={seatCounts[seatStatus.ava]}
                            unavailableCount={seatCounts[seatStatus.emp]}
                        />
                    </div>
                </main>
            </div>

            <Transition show={importSource !== null}>
                <Dialog as="div" className="dialogRoot" onClose={() => setImportSource(null)}>
                    <div className="dialogBackdrop">
                        <div className="dialogScroll">
                            <TransitionChild
                                enter="ease-out duration-200"
                                enterFrom="opacity-0 scale-95"
                                enterTo="opacity-100 scale-100"
                                leave="ease-in duration-150"
                                leaveFrom="opacity-100 scale-100"
                                leaveTo="opacity-0 scale-95"
                            >
                                <DialogPanel className="dialogPanel max-w-4xl">
                                    <div className="flex flex-wrap items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <DialogTitle as="h3" className="dialogTitle">
                                                匯入學生
                                            </DialogTitle>
                                            <p className="fieldNote truncate">
                                                {importSource?.fileName} · 共 {importRows.length} 列
                                            </p>
                                        </div>

                                        {importSource && importSource.sheets.length > 1 && (
                                            <label className="block w-44 shrink-0">
                                                <span className="fieldLabel">工作表</span>
                                                <select
                                                    value={importSource.sheetName}
                                                    onChange={(event) =>
                                                        setImportSource((currentSource) =>
                                                            currentSource
                                                                ? {
                                                                      ...currentSource,
                                                                      sheetName: event.target.value,
                                                                  }
                                                                : currentSource,
                                                        )
                                                    }
                                                    className="selectField bg-[#1C2133]"
                                                >
                                                    {importSource.sheets.map((sheet) => (
                                                        <option key={sheet.name} value={sheet.name}>
                                                            {sheet.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        )}
                                    </div>

                                    <div className="mt-5 space-y-5">
                                        <section>
                                            <div className="mb-2 flex items-baseline gap-2">
                                                <h4 className="text-sm font-medium text-[#EDF0F4]">
                                                    顯示欄位
                                                </h4>
                                                <span className="hintText">
                                                    座位上要顯示的文字。
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                                <label className="block">
                                                    <span className="fieldLabel">方式</span>
                                                    <select
                                                        value={importFormatMode}
                                                        onChange={(event) =>
                                                            setImportFormatMode(
                                                                event.target
                                                                    .value as ImportFormatMode,
                                                            )
                                                        }
                                                        className="selectField bg-[#1C2133]"
                                                    >
                                                        <option value="join-row">合併整列</option>
                                                        <option value="selected-columns">
                                                            組合指定欄位
                                                        </option>
                                                    </select>
                                                </label>

                                                {importFormatMode === "selected-columns" && (
                                                    <label className="block">
                                                        <span className="fieldLabel">欄位</span>
                                                        <input
                                                            type="text"
                                                            inputMode="numeric"
                                                            value={importColumns}
                                                            onChange={(event) =>
                                                                setImportColumns(event.target.value)
                                                            }
                                                            placeholder="例如：1,2,4"
                                                            className="textField bg-[#1C2133] py-2"
                                                        />
                                                        <span className="formHint hintText">
                                                            Excel 的 A 欄是第 1 欄。
                                                        </span>
                                                    </label>
                                                )}

                                                <label className="block">
                                                    <span className="fieldLabel">分隔字元</span>
                                                    <input
                                                        type="text"
                                                        value={importSeparator}
                                                        maxLength={12}
                                                        onChange={(event) =>
                                                            setImportSeparator(event.target.value)
                                                        }
                                                        placeholder="留空代表直接相接"
                                                        className="textField bg-[#1C2133] py-2"
                                                    />
                                                    <span className="formHint hintText">
                                                        目前：{separatorDescription}
                                                    </span>
                                                </label>
                                            </div>
                                        </section>

                                        <div className="h-px bg-[#444B5F]" />

                                        <section>
                                            <div className="mb-2 flex items-baseline gap-2">
                                                <h4 className="text-sm font-medium text-[#EDF0F4]">
                                                    排序依據
                                                </h4>
                                                <span className="hintText">
                                                    排座位時用來分類或排大小的值。
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                                <label className="block">
                                                    <span className="fieldLabel">方式</span>
                                                    <select
                                                        value={importTagSource}
                                                        onChange={(event) =>
                                                            setImportTagSource(
                                                                event.target
                                                                    .value as ImportTagSource,
                                                            )
                                                        }
                                                        className="selectField bg-[#1C2133]"
                                                    >
                                                        {(
                                                            Object.keys(
                                                                IMPORT_TAG_SOURCE_LABELS,
                                                            ) as ImportTagSource[]
                                                        ).map((source) => (
                                                            <option key={source} value={source}>
                                                                {IMPORT_TAG_SOURCE_LABELS[source]}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <span className="formHint hintText">
                                                        {IMPORT_TAG_SOURCE_HINTS[importTagSource]}
                                                    </span>
                                                </label>

                                                {importTagSource === "column" && (
                                                    <label className="block">
                                                        <span className="fieldLabel">欄位</span>
                                                        <input
                                                            type="text"
                                                            inputMode="numeric"
                                                            value={importTagColumn}
                                                            onChange={(event) =>
                                                                setImportTagColumn(
                                                                    event.target.value,
                                                                )
                                                            }
                                                            placeholder="例如：3"
                                                            className="textField bg-[#1C2133] py-2"
                                                        />
                                                        <span className="formHint hintText">
                                                            Excel 的 A 欄是第 1 欄。
                                                        </span>
                                                    </label>
                                                )}
                                            </div>
                                        </section>

                                        <div className="h-px bg-[#444B5F]" />

                                        <label className="optionCard cursor-pointer bg-[#1C2133]">
                                            <input
                                                type="checkbox"
                                                checked={skipFirstRow}
                                                onChange={(event) =>
                                                    setSkipFirstRow(event.target.checked)
                                                }
                                                className="checkboxField"
                                            />
                                            <span>
                                                <span className="optionTitle">略過第一列</span>
                                                <span className="block hintText">
                                                    Excel 第一列是姓名、班級等欄位標題時啟用。
                                                </span>
                                            </span>
                                        </label>

                                        <section>
                                            <div className="mb-2 flex items-baseline gap-2">
                                                <h4 className="text-sm font-medium text-[#EDF0F4]">
                                                    檔案預覽
                                                </h4>
                                                <span className="hintText">
                                                    點欄位標題可以選取要顯示在座位上的欄位
                                                    {importTagSource === "column" &&
                                                        "，點「排」可以選排序依據"}
                                                    。
                                                </span>
                                            </div>

                                            <div className="overflow-x-auto rounded-lg border border-[#444B5F] bg-[#1C2133]">
                                                <table className="importPreviewTable">
                                                    <thead>
                                                        <tr>
                                                            <th className="importPreviewIndexCell">
                                                                列
                                                            </th>
                                                            {importPreviewColumns.map((column) => (
                                                                <th key={column}>
                                                                    <div className="flex items-start gap-1">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                toggleImportColumn(
                                                                                    column,
                                                                                )
                                                                            }
                                                                            aria-pressed={importSelectedColumns.includes(
                                                                                column,
                                                                            )}
                                                                            title={`第 ${column} 欄`}
                                                                            className={`importPreviewColumnButton ${
                                                                                importSelectedColumns.includes(
                                                                                    column,
                                                                                )
                                                                                    ? "importPreviewColumnButtonActive"
                                                                                    : ""
                                                                            }`}
                                                                        >
                                                                            <span className="importPreviewColumnNumber">
                                                                                {column}
                                                                            </span>
                                                                            <span className="truncate">
                                                                                {String(
                                                                                    importRows[0]?.[
                                                                                        column - 1
                                                                                    ] ?? "",
                                                                                )}
                                                                            </span>
                                                                        </button>

                                                                        {importTagSource ===
                                                                            "column" && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    toggleImportTagColumn(
                                                                                        column,
                                                                                    )
                                                                                }
                                                                                aria-pressed={
                                                                                    importTagColumnNumber ===
                                                                                    column
                                                                                }
                                                                                title="設為排序依據"
                                                                                className={`importPreviewTagChip ${
                                                                                    importTagColumnNumber ===
                                                                                    column
                                                                                        ? "importPreviewTagChipActive"
                                                                                        : ""
                                                                                }`}
                                                                            >
                                                                                排
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </th>
                                                            ))}
                                                            <th className="importPreviewResultCell">
                                                                座位文字
                                                            </th>
                                                            {importTagSource !== "none" && (
                                                                <th className="importPreviewResultCell">
                                                                    排序依據
                                                                </th>
                                                            )}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {importPreviewEntries.map(
                                                            (entry, rowIndex) => (
                                                                <tr
                                                                    key={rowIndex}
                                                                    className={
                                                                        entry.skipped || !entry.name
                                                                            ? "importPreviewRowMuted"
                                                                            : ""
                                                                    }
                                                                >
                                                                    <td className="importPreviewIndexCell">
                                                                        {rowIndex + 1}
                                                                    </td>
                                                                    {importPreviewColumns.map(
                                                                        (column) => (
                                                                            <td
                                                                                key={column}
                                                                                className={
                                                                                    importSelectedColumns.includes(
                                                                                        column,
                                                                                    )
                                                                                        ? "importPreviewCellSelected"
                                                                                        : ""
                                                                                }
                                                                            >
                                                                                {String(
                                                                                    entry.row[
                                                                                        column - 1
                                                                                    ] ?? "",
                                                                                )}
                                                                            </td>
                                                                        ),
                                                                    )}
                                                                    <td className="importPreviewResultCell">
                                                                        {entry.skipped
                                                                            ? "已略過"
                                                                            : entry.name ||
                                                                              "空白，不會匯入"}
                                                                    </td>
                                                                    {importTagSource !== "none" && (
                                                                        <td className="importPreviewResultCell">
                                                                            {entry.tag || "—"}
                                                                        </td>
                                                                    )}
                                                                </tr>
                                                            ),
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>

                                            {importRows.length > importPreviewRows.length && (
                                                <span className="formHint hintText">
                                                    僅顯示前 {importPreviewRows.length} 列，共{" "}
                                                    {importRows.length} 列。
                                                </span>
                                            )}
                                        </section>
                                    </div>

                                    <div className="dialogActions items-center justify-between">
                                        <p
                                            className={
                                                importIssue ? "text-xs text-red-400" : "hintText"
                                            }
                                        >
                                            {importIssue ??
                                                `將匯入 ${importStudents.length} 位學生到 ${
                                                    seatCounts[seatStatus.ava]
                                                } 個可分配座位。`}
                                        </p>

                                        <div className="flex shrink-0 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setImportSource(null)}
                                                className="dialogButton dialogButtonGhost"
                                            >
                                                取消
                                            </button>
                                            <button
                                                type="button"
                                                onClick={confirmImportStudents}
                                                disabled={importIssue !== null}
                                                className="dialogButton dialogButtonPrimary"
                                            >
                                                匯入 {importStudents.length} 位學生
                                            </button>
                                        </div>
                                    </div>
                                </DialogPanel>
                            </TransitionChild>
                        </div>
                    </div>
                </Dialog>
            </Transition>

            <Transition show={isExportDialogOpen}>
                <Dialog
                    as="div"
                    className="dialogRoot"
                    onClose={() => setIsExportDialogOpen(false)}
                >
                    <div className="dialogBackdrop">
                        <div className="dialogScroll">
                            <TransitionChild
                                enter="ease-out duration-200"
                                enterFrom="opacity-0 scale-95"
                                enterTo="opacity-100 scale-100"
                                leave="ease-in duration-150"
                                leaveFrom="opacity-100 scale-100"
                                leaveTo="opacity-0 scale-95"
                            >
                                <DialogPanel className="dialogPanel max-w-md">
                                    <DialogTitle as="h3" className="dialogTitle">
                                        匯出座位表
                                    </DialogTitle>

                                    <fieldset className="mt-5">
                                        <legend className="fieldLabel">匯出格式</legend>
                                        <div className="grid grid-cols-3 gap-2">
                                            {(
                                                Object.keys(EXPORT_FORMAT_LABELS) as ExportFormat[]
                                            ).map((format) => (
                                                <label
                                                    key={format}
                                                    className={`cursor-pointer rounded-lg border px-3 py-2 text-center text-sm font-bold transition ${
                                                        exportFormat === format
                                                            ? "border-fuchsia-400 bg-fuchsia-400/10 text-fuchsia-300"
                                                            : "border-[#596178] bg-[#1C2133] text-[#ACB4C0] hover:border-fuchsia-400/50 hover:text-[#EDF0F4]"
                                                    }`}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="exportFormat"
                                                        value={format}
                                                        checked={exportFormat === format}
                                                        onChange={() => setExportFormat(format)}
                                                        className="sr-only"
                                                    />
                                                    {EXPORT_FORMAT_LABELS[format]}
                                                </label>
                                            ))}
                                        </div>
                                    </fieldset>

                                    {exportFormat === "xlsx" ? (
                                        <p className="mt-4 text-sm leading-6 text-[#ACB4C0]">
                                            將依目前的座位列與欄輸出 XLSX 檔案。
                                        </p>
                                    ) : (
                                        <div className="mt-4 space-y-4">
                                            <label className="block">
                                                <span className="fieldLabel">匯出標題</span>
                                                <input
                                                    type="text"
                                                    value={exportTitle}
                                                    maxLength={40}
                                                    onChange={(event) =>
                                                        setExportTitle(event.target.value)
                                                    }
                                                    placeholder="學生座位表"
                                                    className="textField bg-[#1C2133] py-2"
                                                />
                                                <span className="formHint hintText">
                                                    留空時使用「學生座位表」。
                                                </span>
                                            </label>

                                            <label className="optionCard cursor-pointer bg-[#1C2133]">
                                                <input
                                                    type="checkbox"
                                                    checked={showExportPodium}
                                                    onChange={(event) =>
                                                        setShowExportPodium(event.target.checked)
                                                    }
                                                    className="checkboxField"
                                                />
                                                <span>
                                                    <span className="optionTitle">列印講臺</span>
                                                    <span className="block hintText">
                                                        顯示在座位表上方。
                                                    </span>
                                                </span>
                                            </label>

                                            <label className="optionCard cursor-pointer bg-[#1C2133]">
                                                <input
                                                    type="checkbox"
                                                    checked={showExportIndex}
                                                    onChange={(event) =>
                                                        setShowExportIndex(event.target.checked)
                                                    }
                                                    className="checkboxField"
                                                />
                                                <span>
                                                    <span className="optionTitle">
                                                        顯示列欄編號
                                                    </span>
                                                    <span className="block hintText">
                                                        列號在左側、欄號在下方。
                                                    </span>
                                                </span>
                                            </label>
                                        </div>
                                    )}

                                    <div className="dialogActions">
                                        <button
                                            type="button"
                                            onClick={() => setIsExportDialogOpen(false)}
                                            className="dialogButton dialogButtonGhost"
                                        >
                                            取消
                                        </button>
                                        <button
                                            type="button"
                                            onClick={confirmExport}
                                            className="dialogButton dialogButtonPrimary"
                                        >
                                            確認匯出
                                        </button>
                                    </div>
                                </DialogPanel>
                            </TransitionChild>
                        </div>
                    </div>
                </Dialog>
            </Transition>

            <Transition show={isHistoryOpen}>
                <Dialog as="div" className="dialogRoot" onClose={closeSeatHistory}>
                    <div className="dialogBackdrop">
                        <div className="dialogScroll">
                            <TransitionChild
                                enter="ease-out duration-300"
                                enterFrom="opacity-0 scale-95"
                                enterTo="opacity-100 scale-100"
                                leave="ease-in duration-200"
                                leaveFrom="opacity-100 scale-100"
                                leaveTo="opacity-0 scale-95"
                            >
                                <DialogPanel className="dialogPanel max-w-xl">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <DialogTitle
                                                as="h3"
                                                className="select-none text-base/7 font-medium text-[#EDF0F4]"
                                            >
                                                座位紀錄
                                            </DialogTitle>
                                            <p className="fieldNote">
                                                顯示你主動收藏的座位配置，最多 {MAX_HISTORY_COUNT}{" "}
                                                筆。
                                            </p>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                            {seatHistory.length > 0 &&
                                                !isDeleteAllHistoryConfirming && (
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setIsDeleteAllHistoryConfirming(true)
                                                        }
                                                        className="dialogButton dialogButtonDangerOutline py-1.5 text-sm font-medium"
                                                    >
                                                        全部刪除
                                                    </button>
                                                )}
                                            <button
                                                type="button"
                                                onClick={closeSeatHistory}
                                                className="dialogButton dialogButtonGhost py-1.5 text-sm font-normal"
                                            >
                                                關閉
                                            </button>
                                        </div>
                                    </div>

                                    {isDeleteAllHistoryConfirming ? (
                                        <div
                                            role="alert"
                                            className="mt-5 rounded-lg border border-red-400/40 bg-red-400/5 p-4"
                                        >
                                            <p className="text-sm font-medium text-[#EDF0F4]">
                                                刪除全部 {seatHistory.length} 筆座位紀錄？
                                            </p>
                                            <p className="fieldNote">
                                                刪除後無法復原，但不會影響目前畫面上的座位。
                                            </p>
                                            <div className="mt-4 flex justify-end gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setIsDeleteAllHistoryConfirming(false)
                                                    }
                                                    className="dialogButton dialogButtonGhost"
                                                >
                                                    取消
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={deleteAllSeatHistory}
                                                    className="dialogButton dialogButtonDanger"
                                                >
                                                    確認全部刪除
                                                </button>
                                            </div>
                                        </div>
                                    ) : seatHistory.length === 0 ? (
                                        <div className="mt-5 rounded-lg border border-dashed border-[#596178] px-4 py-8 text-center text-sm text-[#ACB4C0]">
                                            尚無紀錄。請輸入收藏名稱並收藏目前配置。
                                        </div>
                                    ) : (
                                        <div className="mt-5 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                                            {seatHistory.map((historyEntry) => {
                                                const occupiedCount = historyEntry.seats.reduce(
                                                    (count, seat) =>
                                                        count +
                                                        Number(seat.status === seatStatus.occ),
                                                    0,
                                                );

                                                return (
                                                    <div
                                                        key={historyEntry.id}
                                                        className="flex items-center justify-between gap-4 rounded-lg border border-[#444B5F] bg-[#1C2133] px-4 py-3"
                                                    >
                                                        <div className="min-w-0">
                                                            <p className="truncate text-sm font-medium text-[#EDF0F4]">
                                                                {historyEntry.name}
                                                            </p>
                                                            <p className="mt-1 text-xs text-[#7F8798]">
                                                                {new Date(
                                                                    historyEntry.createdAt,
                                                                ).toLocaleString("zh-TW")}{" "}
                                                                · {historyEntry.rowCount}列 ×{" "}
                                                                {historyEntry.colCount} 欄 · 已分配{" "}
                                                                {occupiedCount}人
                                                            </p>
                                                        </div>
                                                        <div className="flex shrink-0 gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    deleteSeatHistory(historyEntry)
                                                                }
                                                                className="dialogButton dialogButtonDangerOutline active:opacity-85"
                                                            >
                                                                刪除
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    restoreSeatLayout(historyEntry)
                                                                }
                                                                className="dialogButton dialogButtonOutline active:opacity-85"
                                                            >
                                                                還原
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </DialogPanel>
                            </TransitionChild>
                        </div>
                    </div>
                </Dialog>
            </Transition>

            {seatMenu && seatMenuTarget && (
                <div
                    role="menu"
                    aria-label="座位選單"
                    style={{
                        left: `${seatMenu.x}px`,
                        top: `${seatMenu.y}px`,
                        width: `${SEAT_MENU_WIDTH}px`,
                    }}
                    className="seatMenu"
                    onPointerDown={(event) => event.stopPropagation()}
                    onContextMenu={(event) => event.preventDefault()}
                >
                    {seatMenuTarget.status === seatStatus.emp ? (
                        <button
                            type="button"
                            role="menuitem"
                            className="seatMenuItem"
                            onClick={() => toggleSeatStatusFromMenu(seatMenu.index)}
                        >
                            啟用座位
                        </button>
                    ) : (
                        <>
                            <button
                                type="button"
                                role="menuitem"
                                className="seatMenuItem"
                                onClick={() => openSeatRename(seatMenu.index)}
                            >
                                修改文字
                            </button>
                            {seatMenuTarget.status === seatStatus.occ ? (
                                <>
                                    <button
                                        type="button"
                                        role="menuitem"
                                        className="seatMenuItem"
                                        onClick={() => toggleSeatPin(seatMenu.index)}
                                    >
                                        {seatMenuTarget.pinned ? "取消釘選" : "釘選座位"}
                                    </button>
                                    <button
                                        type="button"
                                        role="menuitem"
                                        className="seatMenuItem text-red-300 hover:text-red-200"
                                        onClick={() => removeSeatStudent(seatMenu.index)}
                                    >
                                        刪除學生
                                    </button>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    role="menuitem"
                                    className="seatMenuItem"
                                    onClick={() => toggleSeatStatusFromMenu(seatMenu.index)}
                                >
                                    停用座位
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}

            <Transition show={isFavoriteDialogOpen}>
                <Dialog as="div" className="dialogRoot" onClose={closeFavoriteDialog}>
                    <div className="dialogBackdrop">
                        <div className="dialogScroll">
                            <TransitionChild
                                enter="ease-out duration-200"
                                enterFrom="opacity-0 scale-95"
                                enterTo="opacity-100 scale-100"
                                leave="ease-in duration-150"
                                leaveFrom="opacity-100 scale-100"
                                leaveTo="opacity-0 scale-95"
                            >
                                <DialogPanel className="dialogPanel max-w-sm">
                                    <form onSubmit={saveSeatLayout}>
                                        <DialogTitle as="h3" className="dialogTitle">
                                            收藏目前座位
                                        </DialogTitle>
                                        <p className="fieldNote">
                                            將目前的 {rowCount} × {colCount}{" "}
                                            座位配置存成一筆紀錄，最多保留 {MAX_HISTORY_COUNT} 筆。
                                        </p>

                                        <label className="mt-5 block">
                                            <span className="fieldLabel">收藏名稱</span>
                                            <input
                                                type="text"
                                                autoFocus
                                                value={favoriteName}
                                                maxLength={40}
                                                onChange={(event) =>
                                                    setFavoriteName(event.target.value)
                                                }
                                                placeholder="例如：三年甲班期中座位"
                                                required
                                                className="textField h-10 bg-[#1C2133]"
                                            />
                                        </label>

                                        <div className="dialogActions">
                                            <button
                                                type="button"
                                                onClick={closeFavoriteDialog}
                                                className="dialogButton dialogButtonGhost"
                                            >
                                                取消
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={!favoriteName.trim()}
                                                className="dialogButton dialogButtonPrimary"
                                            >
                                                儲存收藏
                                            </button>
                                        </div>
                                    </form>
                                </DialogPanel>
                            </TransitionChild>
                        </div>
                    </div>
                </Dialog>
            </Transition>

            <Transition show={renameSeatIndex !== null}>
                <Dialog as="div" className="dialogRoot" onClose={closeSeatRename}>
                    <div className="dialogBackdrop">
                        <div className="dialogScroll">
                            <TransitionChild
                                enter="ease-out duration-200"
                                enterFrom="opacity-0 scale-95"
                                enterTo="opacity-100 scale-100"
                                leave="ease-in duration-150"
                                leaveFrom="opacity-100 scale-100"
                                leaveTo="opacity-0 scale-95"
                            >
                                <DialogPanel className="dialogPanel max-w-sm">
                                    <form onSubmit={submitSeatRename}>
                                        <DialogTitle as="h3" className="dialogTitle">
                                            修改座位文字
                                        </DialogTitle>
                                        <p className="fieldNote">{renameSeatLabel}</p>

                                        <label className="mt-5 block">
                                            <span className="fieldLabel">座位文字</span>
                                            <input
                                                type="text"
                                                autoFocus
                                                value={renameValue}
                                                maxLength={40}
                                                onChange={(event) =>
                                                    setRenameValue(event.target.value)
                                                }
                                                placeholder="例如：王小明"
                                                className="textField h-10 bg-[#1C2133]"
                                            />
                                            <span className="formHint hintText">
                                                留空代表清除學生，座位會回到可分配狀態。
                                            </span>
                                        </label>

                                        <label className="mt-4 block">
                                            <span className="fieldLabel">排序依據</span>
                                            <input
                                                type="text"
                                                value={renameTagValue}
                                                maxLength={20}
                                                onChange={(event) =>
                                                    setRenameTagValue(event.target.value)
                                                }
                                                placeholder="例如：男、A 組、85"
                                                className="textField h-10 bg-[#1C2133]"
                                            />
                                            <span className="formHint hintText">
                                                顯示在姓名後方，座位排序時會依它分類或比大小。
                                            </span>
                                        </label>

                                        <div className="dialogActions">
                                            <button
                                                type="button"
                                                onClick={closeSeatRename}
                                                className="dialogButton dialogButtonGhost"
                                            >
                                                取消
                                            </button>
                                            <button
                                                type="submit"
                                                className="dialogButton dialogButtonPrimary"
                                            >
                                                儲存
                                            </button>
                                        </div>
                                    </form>
                                </DialogPanel>
                            </TransitionChild>
                        </div>
                    </div>
                </Dialog>
            </Transition>

            <Transition
                show={isOperationNoticeVisible}
                enter="transition ease-out duration-200"
                enterFrom="translate-y-2 opacity-0"
                enterTo="translate-y-0 opacity-100"
                leave="transition ease-in duration-150"
                leaveFrom="translate-y-0 opacity-100"
                leaveTo="translate-y-2 opacity-0"
            >
                <div role="status" aria-live="polite" className="operationToast">
                    <span
                        aria-hidden="true"
                        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-green-400/15 text-xs text-green-400"
                    >
                        ✓
                    </span>
                    <span>{operationNotice?.message}</span>
                </div>
            </Transition>
        </>
    );
};
