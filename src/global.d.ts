// Extend the Window interface globally
interface Window {
  saveClickData?: (clickData: ClickedElementInfo) => void;
}