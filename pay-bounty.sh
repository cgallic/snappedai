#!/bin/bash
# Pay SNAP bounty to a Solana address
# Usage: ./pay-bounty.sh <recipient_address> <amount> <reason>

export PATH="/root/.local/share/solana/install/active_release/bin:$PATH"
SNAP_MINT="8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX"
KEYPAIR="/root/.config/solana/snap-wallet.json"
LOG="/var/www/snap/data/bounty-payments.json"

RECIPIENT=$1
AMOUNT=$2
REASON=$3

if [ -z "$RECIPIENT" ] || [ -z "$AMOUNT" ]; then
  echo "Usage: ./pay-bounty.sh <sol_address> <amount> <reason>"
  exit 1
fi

# Check balance first
BALANCE=$(spl-token balance $SNAP_MINT --owner $KEYPAIR 2>/dev/null)
echo "Current balance: $BALANCE SNAP"
echo "Sending: $AMOUNT SNAP to $RECIPIENT"
echo "Reason: $REASON"

read -p "Confirm? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  TX=$(spl-token transfer $SNAP_MINT $AMOUNT $RECIPIENT --owner $KEYPAIR --fund-recipient --allow-unfunded-recipient 2>&1)
  echo "$TX"
  
  # Log payment
  mkdir -p $(dirname $LOG)
  echo "{\"to\":\"$RECIPIENT\",\"amount\":$AMOUNT,\"reason\":\"$REASON\",\"tx\":\"$(echo $TX | grep -o '[A-Za-z0-9]\{44,\}' | tail -1)\",\"date\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >> $LOG
  echo "Logged to $LOG"
fi
