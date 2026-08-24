interface SeatExportItem {
    status: string;
    name: string;
}

interface SeatExportLayout {
    rowCount: number;
    colCount: number;
    seats: readonly SeatExportItem[];
}

interface SeatExportOptions {
    title?: string;
    showPodium?: boolean;
    showIndex?: boolean;
}

interface SeatExportPalette {
    fill: string;
    border: string;
    text: string;
    fallbackLabel: string;
}

const EXPORT_SCALE = 2;
const MIN_EXPORT_WIDTH = 720;
const EXPORT_PADDING = 48;
const EXPORT_HEADER_HEIGHT = 92;
const PODIUM_HEIGHT = 42;
const PODIUM_GAP = 24;
const SEAT_WIDTH = 136;
const SEAT_HEIGHT = 54;
const SEAT_GAP = 12;
const INDEX_GUTTER = 44;
const INDEX_FOOTER = 40;
const DEFAULT_EXPORT_TITLE = "學生座位表";

const getSeatPalette = (status: string): SeatExportPalette => {
    if (status === "occ") {
        return {
            fill: "#EFF6FF",
            border: "#60A5FA",
            text: "#1E40AF",
            fallbackLabel: "已分配",
        };
    }

    if (status === "emp") {
        return {
            fill: "#FEF2F2",
            border: "#F87171",
            text: "#991B1B",
            fallbackLabel: "停用",
        };
    }

    return {
        fill: "#ECFDF5",
        border: "#4ADE80",
        text: "#166534",
        fallbackLabel: "空位",
    };
};

const fitCanvasText = (context: CanvasRenderingContext2D, text: string, maxWidth: number) => {
    if (context.measureText(text).width <= maxWidth) return text;

    const characters = Array.from(text);
    let start = 0;
    let end = characters.length;

    while (start < end) {
        const middle = Math.ceil((start + end) / 2);
        const candidate = `${characters.slice(0, middle).join("")}…`;
        if (context.measureText(candidate).width <= maxWidth) {
            start = middle;
        } else {
            end = middle - 1;
        }
    }

    return `${characters.slice(0, start).join("")}…`;
};

const createSeatLayoutCanvas = (layout: SeatExportLayout, options: SeatExportOptions) => {
    const title = options.title?.trim() || DEFAULT_EXPORT_TITLE;
    const podiumSpace = options.showPodium ? PODIUM_HEIGHT + PODIUM_GAP : 0;
    const indexGutter = options.showIndex ? INDEX_GUTTER : 0;
    const indexFooter = options.showIndex ? INDEX_FOOTER : 0;
    const gridWidth = layout.colCount * SEAT_WIDTH + (layout.colCount - 1) * SEAT_GAP;
    const gridHeight = layout.rowCount * SEAT_HEIGHT + (layout.rowCount - 1) * SEAT_GAP;
    const contentWidth = gridWidth + indexGutter;
    const exportWidth = Math.max(MIN_EXPORT_WIDTH, contentWidth + EXPORT_PADDING * 2);
    const exportHeight =
        EXPORT_HEADER_HEIGHT + podiumSpace + gridHeight + indexFooter + EXPORT_PADDING;
    const canvas = document.createElement("canvas");
    canvas.width = exportWidth * EXPORT_SCALE;
    canvas.height = exportHeight * EXPORT_SCALE;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");

    context.scale(EXPORT_SCALE, EXPORT_SCALE);
    context.fillStyle = "#F7F8FC";
    context.fillRect(0, 0, exportWidth, exportHeight);

    context.fillStyle = "#252A3B";
    context.font = '700 28px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(
        fitCanvasText(context, title, exportWidth - EXPORT_PADDING * 2),
        EXPORT_PADDING,
        42,
    );

    context.fillStyle = "#D946EF";
    context.fillRect(EXPORT_PADDING, 70, exportWidth - EXPORT_PADDING * 2, 2);

    const gridX = (exportWidth - contentWidth) / 2 + indexGutter;
    const gridY = EXPORT_HEADER_HEIGHT + podiumSpace;

    if (options.showPodium) {
        const podiumWidth = Math.min(gridWidth, Math.max(240, Math.round(gridWidth * 0.45)));
        const podiumX = gridX + (gridWidth - podiumWidth) / 2;

        context.beginPath();
        context.roundRect(podiumX, EXPORT_HEADER_HEIGHT, podiumWidth, PODIUM_HEIGHT, 10);
        context.fillStyle = "#252A3B";
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = "#D946EF";
        context.stroke();
        context.fillStyle = "#FDF4FF";
        context.font = '700 16px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(
            "講臺",
            podiumX + podiumWidth / 2,
            EXPORT_HEADER_HEIGHT + PODIUM_HEIGHT / 2,
        );
    }

    layout.seats.forEach((seat, index) => {
        const rowIndex = Math.floor(index / layout.colCount);
        const colIndex = index % layout.colCount;
        const x = gridX + colIndex * (SEAT_WIDTH + SEAT_GAP);
        const y = gridY + rowIndex * (SEAT_HEIGHT + SEAT_GAP);
        const palette = getSeatPalette(seat.status);

        context.beginPath();
        context.roundRect(x, y, SEAT_WIDTH, SEAT_HEIGHT, 10);
        context.fillStyle = palette.fill;
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = palette.border;
        context.stroke();

        context.fillStyle = palette.text;
        context.font = '700 16px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
        context.textAlign = "center";
        const label =
            seat.status === "emp"
                ? palette.fallbackLabel
                : seat.name.trim() || palette.fallbackLabel;
        context.fillText(
            fitCanvasText(context, label, SEAT_WIDTH - 20),
            x + SEAT_WIDTH / 2,
            y + SEAT_HEIGHT / 2,
        );
    });

    if (options.showIndex) {
        context.fillStyle = "#667085";
        context.font = '700 16px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
        context.textBaseline = "middle";

        context.textAlign = "right";
        for (let row = 0; row < layout.rowCount; row++) {
            context.fillText(
                String(row + 1),
                gridX - 14,
                gridY + row * (SEAT_HEIGHT + SEAT_GAP) + SEAT_HEIGHT / 2,
            );
        }

        context.textAlign = "center";
        for (let col = 0; col < layout.colCount; col++) {
            context.fillText(
                String(col + 1),
                gridX + col * (SEAT_WIDTH + SEAT_GAP) + SEAT_WIDTH / 2,
                gridY + gridHeight + INDEX_FOOTER / 2,
            );
        }
    }

    return canvas;
};

const canvasToPngBlob = (canvas: HTMLCanvasElement) =>
    new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new Error("Unable to create PNG"));
            }
        }, "image/png");
    });

export const exportSeatLayoutAsPng = async (
    layout: SeatExportLayout,
    options: SeatExportOptions = {},
) => {
    const canvas = createSeatLayoutCanvas(layout, options);
    const [blob, { saveAs }] = await Promise.all([canvasToPngBlob(canvas), import("file-saver")]);
    saveAs(blob, `${DEFAULT_EXPORT_TITLE}.png`);
};

export const exportSeatLayoutAsPdf = async (
    layout: SeatExportLayout,
    options: SeatExportOptions = {},
) => {
    const title = options.title?.trim() || DEFAULT_EXPORT_TITLE;
    const canvas = createSeatLayoutCanvas(layout, options);
    const [{ jsPDF }, { saveAs }] = await Promise.all([import("jspdf"), import("file-saver")]);
    const orientation = canvas.width >= canvas.height ? "landscape" : "portrait";
    const document = new jsPDF({
        orientation,
        unit: "mm",
        format: "a4",
        compress: true,
    });
    const pageWidth = document.internal.pageSize.getWidth();
    const pageHeight = document.internal.pageSize.getHeight();
    const margin = 10;
    const imageScale = Math.min(
        (pageWidth - margin * 2) / canvas.width,
        (pageHeight - margin * 2) / canvas.height,
    );
    const imageWidth = canvas.width * imageScale;
    const imageHeight = canvas.height * imageScale;

    document.setProperties({ title });
    document.addImage(
        canvas,
        "PNG",
        (pageWidth - imageWidth) / 2,
        (pageHeight - imageHeight) / 2,
        imageWidth,
        imageHeight,
        undefined,
        "FAST",
    );
    saveAs(document.output("blob"), `${DEFAULT_EXPORT_TITLE}.pdf`);
};
