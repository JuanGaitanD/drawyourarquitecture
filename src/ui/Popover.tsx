import * as RadixPopover from '@radix-ui/react-popover';
import type { ComponentProps } from 'react';
import styles from './Popover.module.css';

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;
export const PopoverClose = RadixPopover.Close;

export function PopoverContent({ className, ...rest }: ComponentProps<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        sideOffset={8}
        collisionPadding={8}
        className={[styles.content, className].filter(Boolean).join(' ')}
        {...rest}
      />
    </RadixPopover.Portal>
  );
}
