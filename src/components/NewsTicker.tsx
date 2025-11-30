import React from "react";
import { NewsItem } from "../types";

interface Props {
  theme: string;
  news: NewsItem[];
}

const NewsTicker: React.FC<Props> = ({ theme, news }) => {
  const isDark = theme === "dark";

  const bg = isDark
    ? "bg-black/30 border-gray-700/50"
    : "bg-white/70 border-gray-300";

  return (
    <div
      className={`w-full border rounded-lg px-3 py-2 overflow-hidden ${bg} backdrop-blur-sm`}
    >
      <div className="animate-marquee whitespace-nowrap text-sm flex space-x-10">
        {news.map((item) => (
          <div
            key={item.id}
            className="flex items-center space-x-2 opacity-80"
          >
            <span
              className={
                item.sentiment === "positive"
                  ? "text-green-400"
                  : item.sentiment === "negative"
                  ? "text-red-400"
                  : "text-yellow-400"
              }
            >
              ●
            </span>
            <span className={isDark ? "text-gray-300" : "text-gray-700"}>
              {item.headline}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default NewsTicker;