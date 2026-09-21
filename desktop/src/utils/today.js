// "Heute" als lokales Datum YYYY-MM-DD (nicht UTC). Aufrufen nur in Handlern oder per useState(() => todayLocal()),
// nie im Render (react-hooks/purity).
export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
