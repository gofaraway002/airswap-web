import { useEffect, useState } from "react";

import { Wrapper } from "@airswap/libraries";
import {
  ADDRESS_ZERO,
  OrderERC20,
  ProtocolIds,
  UnsignedOrderERC20,
} from "@airswap/utils";
import { noop } from "@react-hookz/web/esnext/util/const";
import { useWeb3React } from "@web3-react/core";

import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { ExtendedPricing } from "../../entities/ExtendedPricing/ExtendedPricing";
import { getOrderExpiryWithBufferInSeconds } from "../../entities/OrderERC20/OrderERC20Helpers";
import { PricingErrorType } from "../../errors/pricingError";
import useNativeWrappedToken from "../../hooks/useNativeWrappedToken";
import useSwapType from "../../hooks/useSwapType";
import useTokenInfo from "../../hooks/useTokenInfo";
import { SwapType } from "../../types/swapType";
import { getGasPrice } from "../gasCost/gasCostApi";
import { selectProtocolFee } from "../metadata/metadataSlice";
import { selectTradeTerms } from "../tradeTerms/tradeTermsSlice";
import useQuotesDebug from "./hooks/useQuotesDebug";
import {
  compareOrdersAndSetBestOrder,
  createLastLookUnsignedOrder,
} from "./quotesActions";
import { fetchBestPricing, fetchBestRfqOrder } from "./quotesApi";
import { reset } from "./quotesSlice";

interface UseQuotesValues {
  isLoading: boolean;
  isFailed: boolean;
  bestPricing?: ExtendedPricing;
  bestOrder?: OrderERC20 | UnsignedOrderERC20;
  bestOrderType?: ProtocolIds.RequestForQuoteERC20 | ProtocolIds.LastLookERC20;
  bestQuote?: string;
  error?: PricingErrorType;
}

const useQuotes = (isSubmitted: boolean): UseQuotesValues => {
  const dispatch = useAppDispatch();

  const { account, chainId, library } = useWeb3React();
  const {
    baseToken,
    baseAmount: baseTokenAmount,
    quoteToken,
  } = useAppSelector(selectTradeTerms);
  const protocolFee = useAppSelector(selectProtocolFee);
  const {
    isLoading: isGasCostLoading,
    isSuccessful: isGasCostSuccessful,
    swapTransactionCost,
  } = useAppSelector((state) => state.gasCost);
  const {
    disableLastLook,
    disableRfq,
    isLastLookLoading,
    isRfqLoading,
    bestPricing,
    bestRfqOrder,
    bestLastLookOrder,
    bestOrder,
    bestOrderType,
    bestQuote,
    lastLookError,
    rfqError,
  } = useAppSelector((state) => state.quotes);

  const isLoading = isLastLookLoading || isRfqLoading || isGasCostLoading;
  const baseTokenInfo = useTokenInfo(baseToken.address);
  const quoteTokenInfo = useTokenInfo(quoteToken.address);
  const wrappedTokenInfo = useNativeWrappedToken(chainId);

  const error =
    !isLoading && !bestOrder ? lastLookError || rfqError : undefined;

  const [fetchCount, setFetchCount] = useState(0);

  const swapType = useSwapType(baseTokenInfo, quoteTokenInfo);
  const justifiedBaseTokenInfo =
    swapType === SwapType.swapWithWrap ? wrappedTokenInfo : baseTokenInfo;
  const justifiedQuoteTokenInfo =
    quoteTokenInfo?.address === ADDRESS_ZERO
      ? wrappedTokenInfo
      : quoteTokenInfo;

  useQuotesDebug();

  useEffect(() => {
    setFetchCount(isSubmitted ? 1 : 0);
  }, [isSubmitted]);

  useEffect(() => {
    if (!bestOrder) {
      return noop;
    }

    const expiry = getOrderExpiryWithBufferInSeconds(bestOrder.expiry);
    const timeout = expiry * 1000 - Date.now();

    const intervalId = setTimeout(() => {
      setFetchCount(fetchCount + 1);
    }, timeout);

    return () => clearInterval(intervalId);
  }, [bestOrder]);

  useEffect(() => {
    if (
      !chainId ||
      !library ||
      !isSubmitted ||
      !justifiedBaseTokenInfo ||
      !justifiedQuoteTokenInfo ||
      !account
    ) {
      return;
    }

    if (!fetchCount) {
      dispatch(reset());

      return;
    }

    dispatch(getGasPrice({ chainId }));

    dispatch(
      fetchBestPricing({
        provider: library,
        baseToken: baseToken.address,
        baseTokenAmount,
        quoteToken: quoteToken.address,
        chainId: chainId,
        protocolFee,
      })
    );

    dispatch(
      fetchBestRfqOrder({
        provider: library,
        baseTokenAmount,
        baseToken: justifiedBaseTokenInfo,
        chainId,
        quoteToken: justifiedQuoteTokenInfo,
        senderWallet:
          swapType === SwapType.swapWithWrap
            ? Wrapper.getAddress(chainId)!
            : account,
      })
    );
  }, [fetchCount]);

  useEffect(() => {
    if (
      !chainId ||
      !library ||
      !account ||
      !bestPricing ||
      !justifiedBaseTokenInfo ||
      !justifiedQuoteTokenInfo
    ) {
      return;
    }

    dispatch(
      createLastLookUnsignedOrder({
        account,
        baseToken: justifiedBaseTokenInfo,
        baseAmount: baseTokenAmount,
        pricing: bestPricing,
        protocolFee,
        quoteToken: justifiedQuoteTokenInfo,
      })
    );
  }, [bestPricing]);

  useEffect(() => {
    if (
      isLoading ||
      !justifiedQuoteTokenInfo ||
      !isSubmitted ||
      !isGasCostSuccessful
    ) {
      return;
    }

    dispatch(
      compareOrdersAndSetBestOrder(
        justifiedQuoteTokenInfo,
        disableLastLook ? undefined : bestLastLookOrder,
        disableRfq ? undefined : bestRfqOrder,
        swapTransactionCost
      )
    );
  }, [
    isGasCostSuccessful,
    disableLastLook,
    disableRfq,
    bestLastLookOrder,
    bestRfqOrder,
  ]);

  if (swapType === SwapType.wrapOrUnwrap) {
    return {
      isFailed: false,
      isLoading: false,
      ...(isSubmitted && { bestQuote: baseTokenAmount }),
    };
  }

  return {
    isFailed: !isLoading && !!error,
    isLoading: isLastLookLoading || isRfqLoading,
    bestPricing,
    bestOrder,
    bestOrderType,
    bestQuote,
    error,
  };
};

export default useQuotes;
