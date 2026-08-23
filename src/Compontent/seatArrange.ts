import {
  createSeat,
  seatStatus,
  shuffle,
  type Seat,
  type SeatStudent,
} from "./seatModel";

export type ArrangeMode = "random" | "category" | "exam" | "numeric";
export type ExamPattern = "column-gap" | "checkerboard";
export type NumericOrder = "asc" | "desc";
export type NumericGrouping = "row-major" | "snake" | "column-major" | "block";

export type PlannedArrangeMode = Exclude<ArrangeMode, "random">;

export interface ArrangeOptions {
  mode: PlannedArrangeMode;
  examPattern: ExamPattern;
  numericOrder: NumericOrder;
  numericGrouping: NumericGrouping;
  /** 同一群（同類別或同一列／排／區塊）內是否重新隨機順序。 */
  randomizeWithinGroup: boolean;
}

export interface ArrangeInput {
  rowCount: number;
  colCount: number;
  seats: readonly Seat[];
}

export type ArrangeResult =
  | { ok: true; seats: Seat[]; filledOrder: number[] }
  | { ok: false; error: string };

export const ARRANGE_MODE_LABELS: Record<ArrangeMode, string> = {
  random: "完全隨機",
  category: "依類別交錯",
  exam: "考試座",
  numeric: "依數值大小填入",
};

export const EXAM_PATTERN_LABELS: Record<ExamPattern, string> = {
  "column-gap": "隔一欄留空",
  checkerboard: "棋盤式坐法",
};

export const NUMERIC_ORDER_LABELS: Record<NumericOrder, string> = {
  asc: "升冪（小 → 大）",
  desc: "降冪（大 → 小）",
};

export const NUMERIC_GROUPING_LABELS: Record<NumericGrouping, string> = {
  "row-major": "橫向填入（一列為一群）",
  snake: "S 型填入（一排為一群）",
  "column-major": "直向填入（一排為一群）",
  block: "2×2 區塊（一塊為一群）",
};

const TAG_NUMBER_PATTERN = /-?\d+(?:\.\d+)?/;

const isPinnedSeat = (seat: Seat) =>
  seat.status === seatStatus.occ && seat.pinned;

const isMovableSeat = (seat: Seat) =>
  seat.status === seatStatus.occ && !seat.pinned;

const collectMovableStudents = (seats: readonly Seat[]): SeatStudent[] =>
  seats
    .filter(isMovableSeat)
    .map((seat) => ({ name: seat.name, tag: seat.tag }));

/** 可以重新安排的座位：未釘選且沒有被停用。 */
const collectTargetIndexes = (seats: readonly Seat[]) =>
  seats.reduce<number[]>((indexes, seat, index) => {
    if (seat.status !== seatStatus.emp && !isPinnedSeat(seat)) {
      indexes.push(index);
    }
    return indexes;
  }, []);

const isExamSeatOpen = (row: number, col: number, pattern: ExamPattern) =>
  pattern === "column-gap" ? col % 2 === 0 : (row + col) % 2 === 0;

const toSortableNumber = (tag: string) => {
  const match = tag.match(TAG_NUMBER_PATTERN);
  return match ? Number(match[0]) : Number.NaN;
};

const sortStudentsByNumber = (
  students: readonly SeatStudent[],
  order: NumericOrder,
) =>
  [...students].sort((left, right) => {
    const leftValue = toSortableNumber(left.tag);
    const rightValue = toSortableNumber(right.tag);
    const hasLeftValue = Number.isFinite(leftValue);
    const hasRightValue = Number.isFinite(rightValue);

    // 沒有數值可比較的學生一律排在最後，避免打亂整體順序。
    if (!hasLeftValue && !hasRightValue) return 0;
    if (!hasLeftValue) return 1;
    if (!hasRightValue) return -1;

    return order === "asc" ? leftValue - rightValue : rightValue - leftValue;
  });

/** 依分群方式把整張座位表切成一組一組的座位索引，群內已排好填入順序。 */
const buildSeatGroups = (
  rowCount: number,
  colCount: number,
  grouping: NumericGrouping,
) => {
  const groups: number[][] = [];

  if (grouping === "column-major" || grouping === "snake") {
    for (let col = 0; col < colCount; col++) {
      const group: number[] = [];
      for (let row = 0; row < rowCount; row++) {
        group.push(row * colCount + col);
      }
      // S 型：奇數排由下往上，讓兩排交界處的數值保持連續。
      if (grouping === "snake" && col % 2 === 1) group.reverse();
      groups.push(group);
    }
    return groups;
  }

  if (grouping === "block") {
    for (let rowStart = 0; rowStart < rowCount; rowStart += 2) {
      for (let colStart = 0; colStart < colCount; colStart += 2) {
        const group: number[] = [];
        for (let row = rowStart; row < Math.min(rowStart + 2, rowCount); row++) {
          for (let col = colStart; col < Math.min(colStart + 2, colCount); col++) {
            group.push(row * colCount + col);
          }
        }
        groups.push(group);
      }
    }
    return groups;
  }

  for (let row = 0; row < rowCount; row++) {
    const group: number[] = [];
    for (let col = 0; col < colCount; col++) {
      group.push(row * colCount + col);
    }
    groups.push(group);
  }

  return groups;
};

const groupStudentsByTag = (students: readonly SeatStudent[]) => {
  const buckets = new Map<string, SeatStudent[]>();

  students.forEach((student) => {
    const key = student.tag.trim();
    const bucket = buckets.get(key);
    if (bucket) bucket.push(student);
    else buckets.set(key, [student]);
  });

  return [...buckets.values()];
};

/**
 * 逐一走過座位，每次挑出「與四周鄰座類別不同、且剩下人數最多」的類別，
 * 讓相鄰座位盡量落在不同類別上。
 */
const assignAlternatingByTag = (
  colCount: number,
  rowCount: number,
  targetIndexes: readonly number[],
  students: readonly SeatStudent[],
  randomizeWithinGroup: boolean,
) => {
  const buckets = groupStudentsByTag(students).map((bucket) =>
    randomizeWithinGroup ? shuffle([...bucket]) : [...bucket],
  );
  const assignments = new Map<number, SeatStudent>();
  const orderedTargets = [...targetIndexes].sort((left, right) => left - right);

  for (const seatIndex of orderedTargets) {
    const row = Math.floor(seatIndex / colCount);
    const col = seatIndex % colCount;
    const neighborTags = new Set<string>();

    (
      [
        [row, col - 1],
        [row, col + 1],
        [row - 1, col],
        [row + 1, col],
      ] as const
    ).forEach(([neighborRow, neighborCol]) => {
      if (
        neighborRow < 0 ||
        neighborCol < 0 ||
        neighborRow >= rowCount ||
        neighborCol >= colCount
      ) {
        return;
      }

      const neighbor = assignments.get(neighborRow * colCount + neighborCol);
      if (neighbor) neighborTags.add(neighbor.tag.trim());
    });

    const remaining = buckets.filter((bucket) => bucket.length > 0);
    if (remaining.length === 0) break;

    const preferred = remaining.filter(
      (bucket) => !neighborTags.has(bucket[0].tag.trim()),
    );
    const pool = preferred.length > 0 ? preferred : remaining;
    const picked = pool.reduce((best, bucket) =>
      bucket.length > best.length ? bucket : best,
    );

    const student = picked.shift();
    if (student) assignments.set(seatIndex, student);
  }

  return {
    assignments,
    filledOrder: orderedTargets.filter((seatIndex) =>
      assignments.has(seatIndex),
    ),
  };
};

const assignByNumber = (
  rowCount: number,
  colCount: number,
  targetIndexes: readonly number[],
  students: readonly SeatStudent[],
  options: ArrangeOptions,
) => {
  const sortedStudents = sortStudentsByNumber(students, options.numericOrder);
  const targetSet = new Set(targetIndexes);
  const groups = buildSeatGroups(rowCount, colCount, options.numericGrouping)
    .map((group) => group.filter((seatIndex) => targetSet.has(seatIndex)))
    .filter((group) => group.length > 0);

  const assignments = new Map<number, SeatStudent>();
  const filledOrder: number[] = [];
  let cursor = 0;

  groups.forEach((group) => {
    const groupStudents = sortedStudents.slice(cursor, cursor + group.length);
    cursor += group.length;
    if (options.randomizeWithinGroup) shuffle(groupStudents);

    group.forEach((seatIndex, position) => {
      const student = groupStudents[position];
      if (!student) return;

      assignments.set(seatIndex, student);
      filledOrder.push(seatIndex);
    });
  });

  return { assignments, filledOrder };
};

export const arrangeSeats = (
  { rowCount, colCount, seats }: ArrangeInput,
  options: ArrangeOptions,
): ArrangeResult => {
  const students = collectMovableStudents(seats);
  if (students.length === 0) {
    return {
      ok: false,
      error: "目前沒有可重新排序的學生，請先匯入學生或取消釘選座位。",
    };
  }

  const hasTag = students.some((student) => student.tag.trim());
  if (options.mode !== "exam" && !hasTag) {
    return {
      ok: false,
      error:
        "這些學生沒有排序依據資料，請在「匯入學生設定」中指定排序依據欄位後重新匯入。",
    };
  }

  const disabledIndexes = new Set<number>();
  let targetIndexes: number[];

  if (options.mode === "exam") {
    targetIndexes = [];
    seats.forEach((seat, index) => {
      if (isPinnedSeat(seat)) return;

      const row = Math.floor(index / colCount);
      const col = index % colCount;
      if (isExamSeatOpen(row, col, options.examPattern)) targetIndexes.push(index);
      else disabledIndexes.add(index);
    });
  } else {
    targetIndexes = collectTargetIndexes(seats);
  }

  if (students.length > targetIndexes.length) {
    return {
      ok: false,
      error: `這個排序方式只有 ${targetIndexes.length} 個可用座位，少於 ${students.length} 位學生，請先增加座位。`,
    };
  }

  const { assignments, filledOrder } =
    options.mode === "numeric"
      ? assignByNumber(rowCount, colCount, targetIndexes, students, options)
      : assignAlternatingByTag(
          colCount,
          rowCount,
          targetIndexes,
          students,
          options.randomizeWithinGroup,
        );

  const nextSeats = seats.map((seat, index) => {
    if (isPinnedSeat(seat)) {
      return createSeat(seatStatus.occ, seat.name, true, seat.tag);
    }

    const student = assignments.get(index);
    if (student) {
      return createSeat(seatStatus.occ, student.name, false, student.tag);
    }

    if (options.mode === "exam") {
      return createSeat(
        disabledIndexes.has(index) ? seatStatus.emp : seatStatus.ava,
      );
    }

    return createSeat(
      seat.status === seatStatus.emp ? seatStatus.emp : seatStatus.ava,
    );
  });

  return { ok: true, seats: nextSeats, filledOrder };
};
