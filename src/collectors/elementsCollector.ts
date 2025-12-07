/**
 * elementsCollector.ts
 * 
 * Extract full DOM information for the clicked element.
 * Includes:
 *  - attributes
 *  - computed styles
 *  - matched rules
 *  - box model / bounding rect
 *  - real event listeners from CDP
 */

import { Page } from 'playwright';
import { ClickedElementInfo, CDPEventListener } from '../types';
import { createCDPSession, getNodeIdBySelector, getEventListenersForNode, getNodeStyles, getBoxModel } from '../utils/cdpClient';
import { warn, debug } from '../utils/logger';

/**
 * Extract full information of the clicked element
 * @param page Playwright Page
 * @param clickData Click data from window.clickAnalysisData
 */
export async function collectElementInfo(
  page: Page,
  clickData: ClickedElementInfo
): Promise<{ elementInfo: ClickedElementInfo; cdpListeners: CDPEventListener[] }> {

  let cdpListeners: CDPEventListener[] = [];

  try {
    const client = await createCDPSession(page);
    if (!client) {
      warn('CDP session was not created for element collection');
      return { elementInfo: clickData, cdpListeners: [] };
    }

    if (clickData.cssSelectorGuess) {
      const nodeId = await getNodeIdBySelector(client, clickData.cssSelectorGuess);
      if (nodeId) {

        // Event listeners
        cdpListeners = await getEventListenersForNode(client, nodeId);

        // CSS styles
        const styles = await getNodeStyles(client, nodeId);
        if (styles) {
          (clickData as any).computedStyles = styles.computed;
          (clickData as any).matchedRules = styles.matchedRules;
        }

        // Box model
        const box = await getBoxModel(client, nodeId);
        if (box) {
          (clickData as any).boxModel = box;
        }

        debug(`Clicked element info collected using CSS selector: ${clickData.cssSelectorGuess}`);
      } else {
        warn(`NodeId not found for selector: ${clickData.cssSelectorGuess}`);
      }
    } else {
      warn('cssSelectorGuess not available for the clicked element');
    }

  } catch (e) {
    warn(`Error collecting element information: ${(e as Error).message}`);
  }

  return { elementInfo: clickData, cdpListeners };
}
