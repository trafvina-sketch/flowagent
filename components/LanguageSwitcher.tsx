import React from 'react';
import { useTranslation } from 'react-i18next';
import { languages } from '../src/languages';

const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();
  console.log('LanguageSwitcher rendered, current language:', i18n.language);

  return (
    <select
      value={i18n.language}
      onChange={async (e) => {
        console.log('Changing language to:', e.target.value);
        await i18n.changeLanguage(e.target.value);
      }}
      className="bg-zinc-900 text-white text-xs font-bold rounded-xl border border-zinc-700 px-3 py-2 cursor-pointer hover:bg-zinc-800"
    >
      {languages.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.name}
        </option>
      ))}
    </select>
  );
};

export default LanguageSwitcher;
