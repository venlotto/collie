import { createContext, useContext, type ReactNode } from "react";

/** The window controls of the desk window a chat screen sits in, or null outside the desk (a phone, a
 *  narrow window). The chat bars draw them where the phone draws its Back arrow (components/bot-desk.tsx).
 *  A file of its own so the chat bars do not import the desk and its stream. */
export const DeskControlsContext = createContext<ReactNode>(null);

export function useDeskControls(): ReactNode {
  return useContext(DeskControlsContext);
}
