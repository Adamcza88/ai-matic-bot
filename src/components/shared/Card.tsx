import React from 'react';
// Define Theme type here if not available elsewhere
type Theme = 'dark' | 'light';

interface CardProps {
  title?: string;
  theme: Theme;
  children: React.ReactNode;
}

const Card: React.FC<CardProps> = ({ title, theme, children }) => {
  const bg =
    theme === 'dark'
      ? 'bg-slate-900 border-slate-800'
      : 'bg-white border-slate-200';
  const titleColor =
    theme === 'dark'
      ? 'text-emerald-300'
      : 'text-emerald-700';

  return (
    <div className={`rounded-xl border ${bg} p-4`}>
      {title && (
        <h3 className={`mb-3 font-bold text-lg ${titleColor}`}>
          {title}
        </h3>
      )}
      {children}
    </div>
  );
};

export default Card;