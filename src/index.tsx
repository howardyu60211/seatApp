import { SeatTable } from "./Compontent/SeatTable";
import * as appInfo from "../package.json";

export default function Index() {
    return (
        <div className="flex h-screen flex-col overflow-hidden">
            <header className="border-[#444B5F] border-b w-full h-16 shrink-0 flex items-center pl-6">
                <h4 className="select-none titleBar font-bold w-3/4 text-[#EDF0F4] flex-1 h-full content-center">
                    學生座位編排程式 v{appInfo.version}
                </h4>
                <button
                    className="functionalButton basicButtonAnimation mr-6 text-[14px] text-amber-100 hover:border-amber-100"
                    onClick={() => window.close()}
                >
                    關閉程式
                </button>
            </header>

            <SeatTable />
        </div>
    );
}
