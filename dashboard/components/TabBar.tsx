"use client";

interface Tab {
  key: string;
  label: string;
  disabled?: boolean;
}

interface TabBarProps {
  tabs: Tab[];
  activeKey: string;
  onSelect: (key: string) => void;
}

export default function TabBar({ tabs, activeKey, onSelect }: TabBarProps) {
  return (
    <div className="flex rounded overflow-hidden border border-panel-header-text/30">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => { if (!tab.disabled) onSelect(tab.key); }}
          disabled={tab.disabled}
          className={`px-2 py-0.5 text-[10px] font-bold tracking-wider transition-colors ${
            activeKey === tab.key
              ? "bg-panel-header-text/20 text-panel-header-text"
              : "text-panel-header-text/50 hover:text-panel-header-text/80 disabled:opacity-30 disabled:cursor-not-allowed"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
