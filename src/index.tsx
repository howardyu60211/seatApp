import { SeatTable } from "./Compontent/SeatTable";
import * as appInfo from "../package.json";

export default function Index() {
    return (
        <>
            <div className="border-[#444B5F] border-b w-full h-16 flex items-center pl-6">
                <h4 className="select-none titleBar font-bold w-3/4 text-[#EDF0F4] flex-1 h-full content-center">
                    學生座位編排程式 v{appInfo.version}
                </h4>
                <button
                    className="select-none inline-block h-11 px-4 mr-6 mb-0 font-bold text-center uppercase align-middle transition-all bg-transparent border border-solid border-amber-100/0 rounded-lg shadow-none cursor-pointer leading-pro ease-soft-in text-xs bg-150 duration-100 active:opacity-85 tracking-tight-soft hover:border-amber-100 bg-x-25 text-amber-100 text-[14px]"
                    onClick={() => window.close()}
                >
                    關閉程式
                </button>
            </div>

            <SeatTable />
        </>
    );
}
