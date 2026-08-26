interface StatusBarProps {
    occupiedCount: number;
    availableCount: number;
    unavailableCount: number;
}

export default function StatusBar({
    occupiedCount,
    availableCount,
    unavailableCount,
}: StatusBarProps) {
    return (
        <div className="select-none shrink-0 ml-auto flex justify-end gap-4 px-1 text-sm">
            <div className="text-green-400">可分配: {availableCount}</div>
            <div className="text-blue-400">已分配: {occupiedCount}</div>
            <div className="text-red-400">不可分配: {unavailableCount}</div>
        </div>
    );
}
