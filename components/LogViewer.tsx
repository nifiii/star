import React, { useRef, useEffect } from 'react';
import { LogEntry } from '../types';

interface Props {
  logs: LogEntry[];
}

const LogViewer: React.FC<Props> = ({ logs }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="bg-slate-800 p-1 rounded-3xl shadow-xl border-4 border-slate-700/50 mt-6">
      <div className="bg-slate-900 rounded-[1.2rem] p-4 h-48 overflow-y-auto font-mono text-xs relative">
        {/* Decorative dots to look like a terminal/window */}
        <div className="flex gap-1.5 absolute top-3 right-3 opacity-50">
           <div className="w-2 h-2 rounded-full bg-red-500"></div>
           <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
           <div className="w-2 h-2 rounded-full bg-green-500"></div>
        </div>
        
        <div className="mt-2 space-y-2">
          {logs.length === 0 && (
            <div className="text-slate-600 italic text-center mt-10">
              ... 等待指令中 ...
              <br/>
              (Ready to Start)
            </div>
          )}
          {logs.map((log, index) => (
            <div key={index} className="flex gap-2 animate-fade-in">
              <span className="text-slate-500 shrink-0">[{log.timestamp.split(' ')[0]}]</span>
              <span className={`${
                log.type === 'error' ? 'text-red-400 font-bold' : 
                log.type === 'success' ? 'text-green-400 font-bold' : 'text-slate-300'
              }`}>
                {log.message}
              </span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
};

export default LogViewer;