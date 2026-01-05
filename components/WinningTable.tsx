import React from 'react';
import { WinningNumbers } from '../types';

interface Props {
  data: WinningNumbers | null;
  periods: string[];
  selectedIndex: number;
  onSelectPeriod: (index: number) => void;
  loading: boolean;
  onRefresh: () => void;
}

const WinningTable: React.FC<Props> = ({ data, periods, selectedIndex, onSelectPeriod, loading, onRefresh }) => {
  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 mb-6 border border-gray-100 relative overflow-hidden transition-all hover:shadow-xl">
      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
        <svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-600"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
      </div>
      
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 relative z-10 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">
            {data ? data.period : '載入中...'}
          </h2>
          <p className="text-sm text-gray-500">統一發票中獎號碼單</p>
        </div>
        <button 
          onClick={onRefresh}
          disabled={loading}
          className={`flex items-center space-x-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
            loading 
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
              : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 active:scale-95 shadow-sm'
          }`}
        >
          {loading ? (
             <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
               <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
               <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
             </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16l5 5"/><path d="M21 21v-5h-5"/></svg>
          )}
          <span>{loading ? '更新中' : '更新號碼'}</span>
        </button>
      </div>

      {periods.length > 0 && (
        <div className="flex space-x-2 mb-6 bg-gray-100 p-1.5 rounded-xl relative z-10">
          {periods.map((period, idx) => (
            <button
              key={idx}
              onClick={() => onSelectPeriod(idx)}
              className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all duration-200 ${
                selectedIndex === idx 
                  ? 'bg-white text-indigo-600 shadow-sm transform scale-[1.02]' 
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
              }`}
            >
              {period} {idx === 0 && '(最新)'}
            </button>
          ))}
        </div>
      )}

      {!data && !loading && (
        <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-300">
           <p className="text-gray-500">點擊上方「更新號碼」以取得最新開獎資訊</p>
        </div>
      )}

      {data && (
        <div className="space-y-4 relative z-10 animate-fade-in">
          {/* Special Prize */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-4 border-b border-gray-100 pb-4">
            <div className="text-gray-500 font-medium md:col-span-1 flex items-center">
              <span className="bg-red-100 text-red-600 px-2.5 py-1 rounded text-xs mr-2 font-bold min-w-[60px] text-center">1000萬</span>
              特別獎
            </div>
            <div className="text-2xl font-mono font-bold text-red-600 md:col-span-2 tracking-widest pl-2 md:pl-0">
              {data.specialPrize}
            </div>
          </div>

          {/* Grand Prize */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-4 border-b border-gray-100 pb-4">
            <div className="text-gray-500 font-medium md:col-span-1 flex items-center">
              <span className="bg-orange-100 text-orange-600 px-2.5 py-1 rounded text-xs mr-2 font-bold min-w-[60px] text-center">200萬</span>
              特獎
            </div>
            <div className="text-2xl font-mono font-bold text-gray-800 md:col-span-2 tracking-widest pl-2 md:pl-0">
              {data.grandPrize}
            </div>
          </div>

          {/* First Prize */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-4 border-b border-gray-100 pb-4">
            <div className="text-gray-500 font-medium md:col-span-1 flex items-start pt-1">
              <span className="bg-yellow-100 text-yellow-700 px-2.5 py-1 rounded text-xs mr-2 font-bold min-w-[60px] text-center flex-shrink-0">20萬</span>
              <span className="pt-0.5">頭獎</span>
            </div>
            <div className="text-xl font-mono font-medium text-gray-800 md:col-span-2 space-y-2 pl-2 md:pl-0">
              {data.firstPrize.map((num, idx) => (
                <div key={idx} className="tracking-widest">{num}</div>
              ))}
            </div>
          </div>

          {/* Second to Sixth Prizes Information */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-4 border-b border-gray-100 pb-4">
            <div className="text-gray-500 font-medium md:col-span-1 pt-1">
              其他獎項
            </div>
            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm text-gray-600">
               <div className="flex items-center">
                  <span className="inline-block w-8 font-bold text-gray-700">二獎</span>
                  <span className="bg-gray-100 px-2 py-0.5 rounded text-xs mx-2">4萬元</span>
                  <span className="text-gray-400 text-xs">末 7 碼相同</span>
               </div>
               <div className="flex items-center">
                  <span className="inline-block w-8 font-bold text-gray-700">三獎</span>
                  <span className="bg-gray-100 px-2 py-0.5 rounded text-xs mx-2">1萬元</span>
                  <span className="text-gray-400 text-xs">末 6 碼相同</span>
               </div>
               <div className="flex items-center">
                  <span className="inline-block w-8 font-bold text-gray-700">四獎</span>
                  <span className="bg-gray-100 px-2 py-0.5 rounded text-xs mx-2">4千元</span>
                  <span className="text-gray-400 text-xs">末 5 碼相同</span>
               </div>
               <div className="flex items-center">
                  <span className="inline-block w-8 font-bold text-gray-700">五獎</span>
                  <span className="bg-gray-100 px-2 py-0.5 rounded text-xs mx-2">1千元</span>
                  <span className="text-gray-400 text-xs">末 4 碼相同</span>
               </div>
               <div className="flex items-center">
                  <span className="inline-block w-8 font-bold text-gray-700">六獎</span>
                  <span className="bg-gray-100 px-2 py-0.5 rounded text-xs mx-2">200元</span>
                  <span className="text-gray-400 text-xs">末 3 碼相同</span>
               </div>
            </div>
          </div>

          {/* Additional Sixth Prize */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-4">
             <div className="text-gray-500 font-medium md:col-span-1 flex items-center">
              <span className="bg-blue-100 text-blue-600 px-2.5 py-1 rounded text-xs mr-2 font-bold min-w-[60px] text-center">200元</span>
              增開六獎
            </div>
            <div className="text-xl font-mono font-medium text-gray-800 md:col-span-2 flex flex-wrap gap-4 pl-2 md:pl-0">
              {data.additionalSixthPrize && data.additionalSixthPrize.length > 0 ? (
                data.additionalSixthPrize.map((num, idx) => (
                  <span key={idx} className="tracking-widest">{num}</span>
                ))
              ) : (
                <span className="text-gray-400 text-sm">本期無增開</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WinningTable;