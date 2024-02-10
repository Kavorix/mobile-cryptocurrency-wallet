import { parseInputAmount } from '@celo/utils/lib/parsing'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import BigNumber from 'bignumber.js'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { getNumberFormatSettings } from 'react-native-localize'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useDispatch } from 'react-redux'
import { showError } from 'src/alert/actions'
import { SendEvents } from 'src/analytics/Events'
import ValoraAnalytics from 'src/analytics/ValoraAnalytics'
import { ErrorMessages } from 'src/app/ErrorMessages'
import BackButton from 'src/components/BackButton'
import CommentTextInput from 'src/components/CommentTextInput'
import ContactCircle from 'src/components/ContactCircle'
import Dialog from 'src/components/Dialog'
import LineItemRow from 'src/components/LineItemRow'
import ReviewFrame from 'src/components/ReviewFrame'
import ShortenedAddress from 'src/components/ShortenedAddress'
import TokenDisplay from 'src/components/TokenDisplay'
import TokenTotalLineItem from 'src/components/TokenTotalLineItem'
import Touchable from 'src/components/Touchable'
import CustomHeader from 'src/components/header/CustomHeader'
import InfoIcon from 'src/icons/InfoIcon'
import { getAddressFromPhoneNumber } from 'src/identity/contactMapping'
import { getSecureSendAddress } from 'src/identity/secureSend'
import {
  addressToDataEncryptionKeySelector,
  e164NumberToAddressSelector,
  secureSendPhoneNumberMappingSelector,
} from 'src/identity/selectors'
import { convertToMaxSupportedPrecision } from 'src/localCurrency/convert'
import { getLocalCurrencyCode } from 'src/localCurrency/selectors'
import { noHeader } from 'src/navigator/Headers'
import { Screens } from 'src/navigator/Screens'
import { StackParamList } from 'src/navigator/types'
import { Recipient, RecipientType, getDisplayName } from 'src/recipients/recipient'
import useSelector from 'src/redux/useSelector'
import { sendPayment } from 'src/send/actions'
import { isSendingSelector } from 'src/send/selectors'
import DisconnectBanner from 'src/shared/DisconnectBanner'
import colors from 'src/styles/colors'
import fontStyles, { typeScale } from 'src/styles/fonts'
import { iconHitslop } from 'src/styles/variables'
import {
  useAmountAsUsd,
  useLocalToTokenAmount,
  useTokenInfo,
  useTokenToLocalAmount,
} from 'src/tokens/hooks'
import { tokenSupportsComments } from 'src/tokens/utils'

type OwnProps = NativeStackScreenProps<
  StackParamList,
  Screens.SendConfirmation | Screens.SendConfirmationModal
>
type Props = OwnProps

export const sendConfirmationScreenNavOptions = noHeader

export function useRecipientToSendTo(paramRecipient: Recipient) {
  const secureSendPhoneNumberMapping = useSelector(secureSendPhoneNumberMappingSelector)
  const e164NumberToAddress = useSelector(e164NumberToAddressSelector)
  return useMemo(() => {
    if (!paramRecipient.address && paramRecipient.e164PhoneNumber) {
      const recipientAddress = getAddressFromPhoneNumber(
        paramRecipient.e164PhoneNumber,
        e164NumberToAddress,
        secureSendPhoneNumberMapping,
        undefined
      )

      return {
        ...paramRecipient,
        // Setting the phone number explicitly so Typescript doesn't complain
        e164PhoneNumber: paramRecipient.e164PhoneNumber,
        address: recipientAddress ?? undefined,
        recipientType: RecipientType.PhoneNumber,
      }
    }
    return paramRecipient
  }, [paramRecipient])
}

const { decimalSeparator } = getNumberFormatSettings()

function useInputAmounts(
  inputAmount: string,
  usingLocalAmount: boolean,
  tokenId?: string,
  inputTokenAmount?: BigNumber
) {
  const parsedAmount = parseInputAmount(inputAmount, decimalSeparator)
  const localToToken = useLocalToTokenAmount(parsedAmount, tokenId)
  const tokenToLocal = useTokenToLocalAmount(parsedAmount, tokenId)

  const localAmountRaw = usingLocalAmount ? parsedAmount : tokenToLocal
  // when using the local amount, the "inputAmount" value received here was
  // already converted once from the token value. if we calculate the token
  // value by converting again from local to token, we introduce rounding
  // precision errors. most of the time this is fine but when pressing the "max"
  // button and using the max token value this becomes a problem because the
  // precision error introduced may result in a higher token value than
  // original, preventing the user from sending the amount e.g. the max token
  // balance could be something like 15.00, after conversion to local currency
  // then back to token amount, it could be 15.000000001.

  const tokenAmountRaw = usingLocalAmount ? inputTokenAmount ?? localToToken : parsedAmount
  const localAmount = localAmountRaw && convertToMaxSupportedPrecision(localAmountRaw)

  const tokenAmount = convertToMaxSupportedPrecision(tokenAmountRaw!)
  const usdAmount = useAmountAsUsd(tokenAmount, tokenId)

  return {
    localAmount,
    tokenAmount,
    usdAmount: usdAmount && convertToMaxSupportedPrecision(usdAmount),
  }
}

function SendConfirmation(props: Props) {
  const { t } = useTranslation()

  const {
    origin,
    transactionData: {
      recipient: paramRecipient,
      tokenAmount: inputTokenAmount,
      tokenAddress,
      comment: commentFromParams,
      tokenId,
    },
    feeAmount,
    feeTokenId,
    preparedTransaction,
  } = props.route.params

  const [encryptionDialogVisible, setEncryptionDialogVisible] = useState(false)
  const [comment, setComment] = useState(commentFromParams ?? '')

  const tokenInfo = useTokenInfo(tokenId)
  const addressToDataEncryptionKey = useSelector(addressToDataEncryptionKeySelector)
  const isSending = useSelector(isSendingSelector)
  const fromModal = props.route.name === Screens.SendConfirmationModal
  const localCurrencyCode = useSelector(getLocalCurrencyCode)
  const { localAmount, tokenAmount, usdAmount } = useInputAmounts(
    inputTokenAmount.toString(),
    false,
    tokenId,
    inputTokenAmount
  )

  const dispatch = useDispatch()

  const secureSendPhoneNumberMapping = useSelector(secureSendPhoneNumberMappingSelector)
  const validatedRecipientAddress = getSecureSendAddress(
    paramRecipient,
    secureSendPhoneNumberMapping
  )
  const recipient = useRecipientToSendTo(paramRecipient)

  // preparedTransaction is expected to be present except for some
  // payment requests (which may not include one if a tx is not possible, e.g.,
  // amount > balance, not enough for gas, etc).
  // We could consider making preparedTx a required field if we handle those
  // scenarios differently
  const disableSend = isSending || !preparedTransaction

  const feeTokenInfo = useTokenInfo(feeTokenId)
  const feeInUsd =
    feeAmount && feeTokenInfo?.priceUsd
      ? new BigNumber(feeAmount).times(feeTokenInfo.priceUsd)
      : undefined

  const FeeContainer = () => {
    return (
      <View style={styles.feeContainer}>
        {feeAmount && (
          <LineItemRow
            testID="SendConfirmation/fee"
            title={t('feeEstimate')}
            amount={
              <TokenDisplay
                amount={new BigNumber(feeAmount)}
                tokenId={feeTokenId}
                showLocalAmount={false}
              />
            }
          />
        )}
        <TokenTotalLineItem
          tokenAmount={tokenAmount}
          tokenId={tokenId}
          feeToAddInUsd={feeInUsd}
          showLocalAmountForTotal={false}
          showApproxTotalBalance={true}
          showApproxExchangeRate={true}
        />
      </View>
    )
  }

  const onShowEncryptionModal = () => setEncryptionDialogVisible(true)
  const onDismissEncryptionModal = () => setEncryptionDialogVisible(false)

  const EncryptionWarningLabel = () => {
    const showLabel = !recipient.address || addressToDataEncryptionKey[recipient.address] === null

    return showLabel ? (
      <View style={styles.encryptionWarningLabelContainer}>
        <Text style={styles.encryptionWarningLabel}>{t('encryption.warningLabel')}</Text>
        <Touchable onPress={onShowEncryptionModal} borderless={true} hitSlop={iconHitslop}>
          <InfoIcon color={colors.infoDark} size={14} />
        </Touchable>
      </View>
    ) : null
  }

  const onBlur = () => {
    const trimmedComment = comment.trim()
    setComment(trimmedComment)
  }

  const onSend = () => {
    if (!preparedTransaction) {
      // This should never happen because the confirm button is disabled if this happens.
      dispatch(showError(ErrorMessages.SEND_PAYMENT_FAILED))
      return
    }

    ValoraAnalytics.track(SendEvents.send_confirm_send, {
      origin,
      recipientType: recipient.recipientType,
      isScan: props.route.params.isFromScan,
      localCurrency: localCurrencyCode,
      usdAmount: usdAmount?.toString() ?? null,
      localCurrencyAmount: localAmount?.toString() ?? null,
      tokenAmount: tokenAmount.toString(),
      tokenSymbol: tokenInfo?.symbol ?? '',
      tokenAddress: tokenAddress ?? null,
      networkId: tokenInfo?.networkId ?? null,
      tokenId,
      commentLength: comment.length,
    })

    dispatch(
      sendPayment(
        tokenAmount,
        tokenId,
        usdAmount,
        comment,
        recipient,
        fromModal,
        undefined,
        preparedTransaction
      )
    )
  }

  const allowComment = tokenSupportsComments(tokenInfo)

  return (
    <SafeAreaView
      style={styles.container}
      // No modal display on android so we set edges to undefined
      edges={
        props.route.name === Screens.SendConfirmationModal && Platform.OS === 'ios'
          ? ['bottom']
          : undefined
      }
    >
      <CustomHeader
        style={{ paddingHorizontal: 8 }}
        left={<BackButton eventName={SendEvents.send_confirm_back} />}
      />
      <DisconnectBanner />
      <ReviewFrame
        FooterComponent={FeeContainer}
        LabelAboveKeyboard={EncryptionWarningLabel}
        confirmButton={{
          action: onSend,
          text: t('send'),
          disabled: disableSend,
        }}
        isSending={isSending}
      >
        <View style={styles.transferContainer}>
          <View style={styles.headerContainer}>
            <ContactCircle recipient={recipient} />
            <View style={styles.recipientInfoContainer}>
              <Text style={styles.headerText} testID="HeaderText">
                {t('sending')}
              </Text>
              <Text testID="DisplayName" style={styles.displayName}>
                {getDisplayName(recipient, t)}
              </Text>
              {validatedRecipientAddress && (
                <View style={styles.addressContainer}>
                  <ShortenedAddress style={styles.address} address={validatedRecipientAddress} />
                </View>
              )}
            </View>
          </View>
          <TokenDisplay
            testID="SendAmount"
            style={styles.amount}
            amount={tokenAmount}
            tokenId={tokenId}
            showLocalAmount={false}
          />
          <TokenDisplay
            testID="SendAmountFiat"
            style={styles.amountSubscript}
            amount={tokenAmount}
            tokenId={tokenInfo?.tokenId}
            showLocalAmount={true}
          />
          {allowComment && (
            <CommentTextInput
              testID={'send'}
              onCommentChange={setComment}
              comment={comment}
              onBlur={onBlur}
            />
          )}
        </View>
        {/** Encryption warning dialog */}
        <Dialog
          title={t('encryption.warningModalHeader')}
          isVisible={encryptionDialogVisible}
          actionText={t('dismiss')}
          actionPress={onDismissEncryptionModal}
          isActionHighlighted={false}
          onBackgroundPress={onDismissEncryptionModal}
        >
          {t('encryption.warningModalBody')}
        </Dialog>
      </ReviewFrame>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 8,
  },
  feeContainer: {
    padding: 16,
    paddingBottom: 8,
  },
  transferContainer: {
    alignItems: 'flex-start',
    paddingBottom: 24,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  recipientInfoContainer: {
    paddingLeft: 8,
  },
  headerText: {
    ...fontStyles.regular,
    color: colors.gray4,
  },
  displayName: {
    ...fontStyles.regular500,
  },
  addressContainer: {
    flexDirection: 'row',
  },
  address: {
    ...fontStyles.small,
    color: colors.gray5,
    paddingRight: 4,
  },
  amount: {
    paddingVertical: 8,
    ...fontStyles.largeNumber,
  },
  amountSubscript: {
    ...typeScale.bodyMedium,
    color: colors.gray5,
    paddingBottom: 16,
  },
  encryptionWarningLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 16,
  },
  encryptionWarningLabel: {
    ...fontStyles.regular,
    color: colors.infoDark,
    paddingRight: 8,
  },
})

export default SendConfirmation
