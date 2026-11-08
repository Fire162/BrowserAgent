import { ToolDefinition } from '../llm/types';

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'click',
    description: 'Click on a visible interactive element by its index badge number or CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        elementId: {
          type: 'string',
          description: 'The numeric badge index of the element (e.g. "12") shown on the page.',
        },
        selector: {
          type: 'string',
          description: 'Alternative CSS selector if elementId is not available.',
        },
        reason: {
          type: 'string',
          description: 'Brief reason why you are clicking this element.',
        },
      },
    },
  },
  {
    name: 'type',
    description: 'Type text into an input field or textarea.',
    parameters: {
      type: 'object',
      properties: {
        elementId: {
          type: 'string',
          description: 'The numeric badge index of the input/textarea element.',
        },
        selector: {
          type: 'string',
          description: 'Alternative CSS selector for the input element.',
        },
        text: {
          type: 'string',
          description: 'The exact text string to type.',
        },
        clearFirst: {
          type: 'string',
          description: 'Whether to clear existing text before typing ("true" or "false"). Default "true".',
        },
        pressEnter: {
          type: 'string',
          description: 'Whether to press Enter after typing ("true" or "false"). Default "false".',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'press_key',
    description: 'Press a keyboard key (e.g., "Enter", "Tab", "Escape", "ArrowDown").',
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'The key name to press (e.g. "Enter", "Escape", "Tab", "ArrowDown").',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'scroll',
    description: 'Scroll the active webpage viewport.',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          description: 'Scroll direction: "down" or "up".',
          enum: ['down', 'up'],
        },
        amount: {
          type: 'string',
          description: 'Pixels to scroll (default "500").',
        },
      },
      required: ['direction'],
    },
  },
  {
    name: 'navigate',
    description: 'Navigate the browser tab to a specific URL.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full URL including https://.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'wait',
    description: 'Wait for page animations, network requests, or dynamic elements to load.',
    parameters: {
      type: 'object',
      properties: {
        seconds: {
          type: 'string',
          description: 'Number of seconds to wait (e.g. "2" or "5"). Maximum 10.',
        },
      },
      required: ['seconds'],
    },
  },
  {
    name: 'take_screenshot',
    description: 'Capture a visual screenshot of the current visible tab viewport to inspect visual layout, images, charts, or verify visual appearance.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Why you need a screenshot of the visible screen.',
        },
      },
    },
  },
  {
    name: 'extract_data',
    description: 'Extract specific text, data, table rows, or answers from the current page.',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Description of what data was extracted.',
        },
        extractedData: {
          type: 'string',
          description: 'The raw or formatted extracted content.',
        },
      },
      required: ['extractedData'],
    },
  },
  {
    name: 'ask_user',
    description: 'Ask the user a clarifying question or pause for manual action (e.g. solving a CAPTCHA or 2FA).',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question or instruction for the user.',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'finish',
    description: 'Mark the task as successfully completed and provide the final report to the user.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Comprehensive, structured markdown summary of the completed task and results.',
        },
      },
      required: ['summary'],
    },
  },
];
