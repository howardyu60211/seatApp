export enum seatStatus {
    emp = "emp",
    ava = "ava",
    occ = "occ",
}

export interface Seat {
    status: seatStatus;
    name: string;
    pinned: boolean;
    /** 匯入時記住的排序依據欄位值，只有已分配的座位才會保留。 */
    tag: string;
}

export interface SeatLayout {
    rowCount: number;
    colCount: number;
    seats: Seat[];
}

/** 座位上的學生資料，排序與重抽時會整包搬移。 */
export interface SeatStudent {
    name: string;
    tag: string;
}

export const createSeat = (status = seatStatus.ava, name = "", pinned = false, tag = ""): Seat => ({
    status,
    name: status === seatStatus.emp ? "X" : name,
    // 只有已分配的座位能被釘選，避免狀態與釘選互相矛盾。
    pinned: status === seatStatus.occ && pinned,
    // 排序依據屬於學生，座位沒有人時一併清除。
    tag: status === seatStatus.occ ? tag : "",
});

export const createSeatList = (count: number) => Array.from({ length: count }, () => createSeat());

export const createSeatLayout = (
    rowCount: number,
    colCount: number,
    seats: Seat[],
): SeatLayout => ({
    rowCount,
    colCount,
    seats: seats.map((seat) => ({ ...seat })),
});

export const shuffle = <T>(values: T[]) => {
    for (let i = values.length - 1; i > 0; i--) {
        const randomIndex = Math.floor(Math.random() * (i + 1));
        [values[i], values[randomIndex]] = [values[randomIndex], values[i]];
    }
    return values;
};
