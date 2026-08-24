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
        <div className="select-none py-2 flex flex-row-reverse w-full text-sm">
            <div className="text-right px-2 text-red-400">不可分配: {unavailableCount}</div>
            <div className="text-right px-2 text-blue-400">已分配: {occupiedCount}</div>
            <div className="text-right px-2 text-green-400">可分配: {availableCount}</div>
        </div>
    );
}
