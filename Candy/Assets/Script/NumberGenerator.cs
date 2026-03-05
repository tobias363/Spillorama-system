using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System.Linq;
using TMPro;
using Unity.VisualScripting;
using System;
using System.Reflection;
using System.Net.NetworkInformation;
using DG.Tweening;
//using UnityEditor.IMGUI.Controls;
[System.Serializable]
public class IntListWrapper
{
    public List<int> intList = new();
}
[System.Serializable]
public class FakePattern
{
    public List<int> fakeindex = new();
}
public class NumberGenerator : MonoBehaviour
{
    private bool isPatternIncomeple;
    [SerializeField]
    List<int> extrafakeNO = new();
    [SerializeField]
    List<int> incompleteID = new();
    [SerializeField]
    List<int> availableNumbers = new();
    public List<FakePattern> noWinPattern = new();
    public List<int> totalSelectedPatterns;
    public List<int> allNumbers = new List<int>();

    public List<IntListWrapper> mainSelectedIndexes = new();
    public List<int> selectedPatternIndex = new List<int>();
    public GameObject extraBallObj;
    public GameObject bonusMainObj;
    public SlotController slotController;
    public TextMeshProUGUI autoSpinRemainingPlayText;
    public TextMeshProUGUI extraBallCountText;
    public List<int> random = new List<int>();
    public List<int> generatedNO = new List<int>();
    public CardClass[] cardClasses = new CardClass[4];

    [SerializeField]
    public List<Patterns> patternList;
    public Material matchedMat;
    public Material unMatchedMat;
    private int totalActiveCard = 4;
    private int totalNumInEachCard = 15;
    public int autoSpinCount = 0;
    public int totalExtraBallCount = 0;

    public static bool isExtraBallDone = false;

    private PaylineManager paylineManager;
    public TopperManager topperManager;
    public UIManager uiManager;

    public bool isInitialApiCalled;
     [SerializeField]
    int extraballMatchingNo;
    int randomSkipIndex;
    float startingGameTime;
    DateTime startingGameDate;
    // private float secondsOfARealDay = 24 * 60 * 60;
    public double elapsedRealTime;
    public bool showFreeExtraBalls = false;

    private void OnEnable()
    {
        EventManager.OnPlay += StartGame;
        EventManager.OnAutoSpinStart += StartAutoSpin;
        EventManager.OnBallDisplay += CheckSelectedNumb;
        //EventManager.OnExtraBallCompletion += ShowMissingImg;
        EventManager.OnBonusOver += NextPlay;
        EventManager.OnStartTimer += ShowTimer;
    }

    private void OnDisable()
    {
        EventManager.OnPlay -= StartGame;
        EventManager.OnAutoSpinStart -= StartAutoSpin;
        EventManager.OnBallDisplay -= CheckSelectedNumb;
        EventManager.OnStartTimer -= ShowTimer;
        //EventManager.OnExtraBallCompletion -= ShowMissingImg;
        EventManager.OnBonusOver -= NextPlay;
    }

    // Start is called before the first frame update
    void Start()
    {

        paylineManager = new PaylineManager(this);
        extraBallObj.SetActive(false);
        autoSpinRemainingPlayText.text = "";
        EventManager.isPlayOver = true;
        totalSelectedPatterns.Clear();
        totalSelectedPatterns = NumberManager.instance.currentPatternIndex;

    }


    public void NextPlay()
    {
        //Debug.Log(getGameTime(3600).Second.ToString());
        //Debug.Log(autoSpinCount);


        if (autoSpinCount > 0)
        {
            if (getGameTime() < 30)
            {


                Invoke(nameof(CheckRemainingPlay), 30 - getGameTime());
            }
            else
            {

                Invoke(nameof(CheckRemainingPlay), 0);
            }
        }
    }

    void CheckRemainingPlay()
    {
        EventManager.isPlayOver = true;
        autoSpinRemainingPlayText.text = "";
        autoSpinCount -= 1;
        if (isShowTimer)
        {
            StartAutoSpin(1);
            uiManager.playBtn.interactable = true;

        }
        else
        {
            StartAutoSpin(0);
        }

    }

    private void StartAutoSpin(int count)
    {
        autoSpinCount = count;
        //APIManager.instance.CallApi();
        isBonusSelected = false;
        if (autoSpinCount == 0)
        {
            EventManager.isAutoSpinStart = false;

            autoSpinRemainingPlayText.text = "";

            return;
        }
        else
        {
            //if (autoSpinCount - 1 != 0)
            //    autoSpinRemainingPlayText.text = (autoSpinCount - 1).ToString();
            //else
            //    autoSpinRemainingPlayText.text = "";
        }
        ResetNumb();
        count--;
        EventManager.isPlayOver = false;
        EventManager.Play();
        startingGameTime = Time.time;
        startingGameDate = DateTime.Now;
        //StartGame();
        //Invoke(nameof(StartGame), 2);
    }



    private void StartGame()
    {

        //totalSelectedPatterns.Clear();
        foreach (var wrapper in mainSelectedIndexes)
        {
            wrapper.intList.Clear();
        }
        if (selectedPatternIndex != null)
        {
            // Debug.Log("??????????? " );
            selectedPatternIndex.Clear();
        }

        if (allNumbers != null)
        {
            allNumbers.Clear();
        }
       APIManager.instance.CallApisForFetchData();
    }

    public void PlaceBallAsPerFetch()
    {
        InitializeAllNumbers();

        for (int i = 0; i < totalSelectedPatterns.Count; i++)
        {
            int patternNo = totalSelectedPatterns[i];


            if (patternNo >= 0 && patternNo < patternList.Count)
            {
                for (int a = 0; a < patternList[patternNo].pattern.Count; a++)
                {
                    byte patternValue = patternList[patternNo].pattern[a];

                    if (patternValue == 1)
                    {
                        selectedPatternIndex.Add(a);
                        //Debug.Log("i : " + i + " a: " + a);
                        mainSelectedIndexes[i].intList.Add(a);
                    }

                }
            }
        }
        EventManager.AutoSpinOver(false);
        generatedNO = Numbgen(generatedNO, 30);
        EventManager.GenerateBall(generatedNO);
        allNumbers = GetFilteredNumbers(generatedNO);
        RandomNumberGenerator();

        for (int i = 0; i < totalActiveCard; i++)
        {
            for (int a = 0; a < totalNumInEachCard; a++)
            {
                cardClasses[i].num_text[a].text = cardClasses[i].numb[a].ToString();
            }
        }
        Shuffle(generatedNO);
    }




    void InitializeAllNumbers()
    {
        allNumbers = Enumerable.Range(1, 61).ToList();
    }

    public List<int> GetFilteredNumbers(List<int> generatedNO)
    {
        HashSet<int> generatedNOSet = new HashSet<int>(generatedNO);
        List<int> filteredNumbers = allNumbers
            .Where(num => !generatedNOSet.Contains(num))
            .ToList();

        return filteredNumbers;
    }
    void RandomNumberGenerator()
    {
        GenerateUniqueRandomNumbers();
        DistributeNumbersAcrossCards();

        if (!IsValidPattern()) return;

        int randomCardIndex = GetRandomCardIndexWithFullSet();

        if (randomCardIndex == -1) return;
        ApplyPatternToCard();
    }

    void GenerateUniqueRandomNumbers()
    {
        int i_no = 0;
        int i = 0;
        while (random.Count != 60)
        {
            i_no = UnityEngine.Random.Range(1, 61);

            if (!random.Contains(i_no))
            {
                random.Add(i_no);

                if (i < totalActiveCard)
                {
                    if (cardClasses[i].numb.Count == totalNumInEachCard)
                    {
                        i++;
                    }
                    cardClasses[i].numb.Add(i_no);
                    cardClasses[i].numb.Sort();
                }
            }
        }
    }

    void DistributeNumbersAcrossCards()
    {
        if (generatedNO.Count < selectedPatternIndex.Count)
        {
            return;
        }
    }

    bool IsValidPattern()
    {
        foreach (int index in selectedPatternIndex)
        {
            if (index < 0 || index >= 15)
            {
                return false;
            }
        }
        return true;
    }

    int GetRandomCardIndexWithFullSet()
    {
        int randomCardIndex = UnityEngine.Random.Range(0, totalActiveCard);
        if (cardClasses[randomCardIndex].numb.Count < 15)
        {
            return -1;
        }
        return randomCardIndex;
    }

    List<int> filledIndices = new List<int>();

    void ApplyPatternToCard()
    {
       // Debug.Log("showFreeExtraBalls : " + showFreeExtraBalls);
        System.Random rng = new System.Random();
        HashSet<int> usedCardClasses = new HashSet<int>();

        availableNumbers = new List<int>(allNumbers);

        HashSet<int> usedNumbersOverall = new HashSet<int>();
        int PatternDoneClass = -1;
        int randomeSelectedPatternClass = UnityEngine.Random.Range(0, totalSelectedPatterns.Count);

       // Debug.Log("Selected Class  ::------ " + randomeSelectedPatternClass);
        randomSkipIndex = UnityEngine.Random.Range(0, mainSelectedIndexes[randomeSelectedPatternClass].intList.Count);

        for (int i = 0; i < mainSelectedIndexes.Count; i++)
        {

            if (mainSelectedIndexes[i].intList != null && mainSelectedIndexes[i].intList.Count > 0)
            {
                int randomCardClassIndex;
                do
                {
                    randomCardClassIndex = rng.Next(cardClasses.Length);
                } while (usedCardClasses.Contains(randomCardClassIndex) && usedCardClasses.Count < cardClasses.Length);

                usedCardClasses.Add(randomCardClassIndex);

                HashSet<int> usedIndices = new HashSet<int>();
                HashSet<int> usedNumbersInPattern = new HashSet<int>();
                //  int randomNumber = 1;
                int index = -1;
                int numberToUse = -1;

                // Fill the pattern indices with values from generatedNO
                for (int j = 0; j < mainSelectedIndexes[i].intList.Count; j++)
                {
                    //It will Show Incomplete Pattern, so extraball can complete them
                    if (i == randomeSelectedPatternClass && isPatternIncomeple)
                    {
                        if (j == randomSkipIndex)
                        {
                            continue; // Skip this index and move to the next iteration
                        }
                    }




                    index = mainSelectedIndexes[i].intList[j];

                    if (index >= 0 && index < cardClasses[randomeSelectedPatternClass].numb.Count)
                    {
                        // Find a new number from generatedNO that hasn't been used in this pattern or overall


                        for (int k = 0; k < generatedNO.Count; k++)
                        {
                            if (!usedNumbersOverall.Contains(generatedNO[k]) && !usedNumbersInPattern.Contains(generatedNO[k]))
                            {
                                numberToUse = generatedNO[k];
                                if (i == randomeSelectedPatternClass)
                                {
                                    PatternDoneClass = randomCardClassIndex;
                                }

                                break;
                            }
                        }

                        if (numberToUse != -1)
                        {
                            cardClasses[randomCardClassIndex].numb[index] = numberToUse;
                            usedIndices.Add(index);

                            usedNumbersInPattern.Add(numberToUse);
                            usedNumbersOverall.Add(numberToUse);

                            // Track the filled index
                            filledIndices.Add(index);
                        }
                    }
                }


                //Debug.Log("Pattern Index :: " + i + " ClassNO :: " + PatternDoneClass);

                // Fill remaining cells in the same card class with unique values from availableNumbers
                for (int cellIndex = 0; cellIndex < cardClasses[randomCardClassIndex].numb.Count; cellIndex++)
                {
                    if (!usedIndices.Contains(cellIndex))
                    {
                        if (availableNumbers.Count > 0)
                        {
                            int randomIndex;
                            int numberToAssign;

                            // Ensure the number is unique across all card classes
                            do
                            {
                                randomIndex = rng.Next(availableNumbers.Count);
                                numberToAssign = availableNumbers[randomIndex];
                            } while (usedNumbersOverall.Contains(numberToAssign) && availableNumbers.Count > 0);

                            cardClasses[randomCardClassIndex].numb[cellIndex] = numberToAssign;
                            usedNumbersOverall.Add(numberToAssign);
                            availableNumbers.RemoveAt(randomIndex); // Remove used number
                        }
                        else
                        {
                            // Place a 0 when no unique number is available
                            cardClasses[randomCardClassIndex].numb[cellIndex] = 0;
                            Debug.LogWarning("No unique number available to fill remaining slots. Placed 0.");
                        }
                    }
                }
            }
        }
        int _cardno = -1;
        int incompletefakeSelectedIndex =-1;
        // Step 2: Handle remaining card classes that were not selected in the pattern application
        for (int cardClassIndex = 0; cardClassIndex < cardClasses.Length; cardClassIndex++)
        {
            if (!usedCardClasses.Contains(cardClassIndex))
            {
                // Apply a fake pattern to this card class
                int fakerandomIndex = UnityEngine.Random.Range(0, noWinPattern.Count); // Store the random index
                var selectedPattern = noWinPattern[fakerandomIndex]; // Use the random index to select the pattern
                //Debug.Log("!!!!!!!!!!!!!!!Random Index: " + fakerandomIndex );
                HashSet<int> usedIndices = new HashSet<int>();
                 incompleteID.Clear();
                for (int j = 0; j < selectedPattern.fakeindex.Count; j++)
                {
                    int targetIndex = selectedPattern.fakeindex[j];

                    // Check if targetIndex is within bounds of cardClasses[cardClassIndex].numb
                    if (targetIndex >= 0 && targetIndex < cardClasses[cardClassIndex].numb.Count)
                    {
                        int numberToUse = -1;
                        for (int k = 0; k < generatedNO.Count; k++)
                        {
                            if (!usedNumbersOverall.Contains(generatedNO[k]))
                            {
                                numberToUse = generatedNO[k];
                                break;
                            }
                        }

                        if (numberToUse != -1)
                        {
                            cardClasses[cardClassIndex].numb[targetIndex] = numberToUse;
                            // Debug.Log(" 1111111 numberToUse:  " + numberToUse + " card class : " + cardClasses[cardClassIndex].cardNo);
                            // Debug.Log(" 2222222  SelectedPattern : " + selectedPattern + "  Used ind : " + targetIndex);
                            incompleteID.Add(targetIndex);
                            usedNumbersOverall.Add(numberToUse);
                            usedIndices.Add(targetIndex);
                            _cardno = cardClasses[cardClassIndex].cardNo;
                           // Debug.Log("_cardno " + _cardno);
                            incompletefakeSelectedIndex = fakerandomIndex;
                        }
                       
                    }
                }
                 
                // Fill remaining cells in this card class with unique values from availableNumbers
                for (int cellIndex = 0; cellIndex < cardClasses[cardClassIndex].numb.Count; cellIndex++)
                {
                    if (!usedIndices.Contains(cellIndex))
                    {
                        if (availableNumbers.Count > 0)
                        {
                            int randomIndex;
                            int numberToAssign;

                            // Ensure the number is unique across all card classes
                            do
                            {
                                randomIndex = rng.Next(availableNumbers.Count);
                                numberToAssign = availableNumbers[randomIndex];
                            } while (usedNumbersOverall.Contains(numberToAssign) && availableNumbers.Count > 0);

                            cardClasses[cardClassIndex].numb[cellIndex] = numberToAssign;
                            usedNumbersOverall.Add(numberToAssign);
                            availableNumbers.RemoveAt(randomIndex); // Remove used number
                        }
                        else
                        {
                            // Place a 0 when no unique number is available
                            cardClasses[cardClassIndex].numb[cellIndex] = 0;
                            Debug.LogWarning("No unique number available to apply for fake pattern. Placed 0.");
                        }
                    }
                }
            }
        }

        // Ensure all remaining unfilled slots in cardClasses are filled with unique numbers from availableNumbers
        foreach (var cardClass in cardClasses)
        {
            for (int cellIndex = 0; cellIndex < cardClass.numb.Count; cellIndex++)
            {
                if (cardClass.numb[cellIndex] == 0) // If not yet filled
                {
                    if (availableNumbers.Count > 0)
                    {
                        int randomIndex;
                        int numberToAssign;

                        // Ensure the number is unique across all card classes
                        do
                        {
                            randomIndex = rng.Next(availableNumbers.Count);
                            numberToAssign = availableNumbers[randomIndex];
                        } while (usedNumbersOverall.Contains(numberToAssign) && availableNumbers.Count > 0);

                        cardClass.numb[cellIndex] = numberToAssign;
                        usedNumbersOverall.Add(numberToAssign);
                        availableNumbers.RemoveAt(randomIndex); // Remove used number
                    }
                    else
                    {
                        // Place a 0 when no unique number is available
                        cardClass.numb[cellIndex] = 0;
                        Debug.LogWarning("No unique number available to fill remaining slots. Placed 0.");
                    }
                }
            }
        }

        // Debug: Check for duplicate numbers across all cards
        HashSet<int> allNumbersSet = new HashSet<int>();
        HashSet<int> duplicates = new HashSet<int>();

        foreach (var cardClass in cardClasses)
        {
            foreach (var number in cardClass.numb)
            {
                if (number != 0) // Skip uninitialized slots
                {
                    if (!allNumbersSet.Add(number)) // If number is already in the set, it's a duplicate
                    {
                        duplicates.Add(number);
                    }
                }
            }
        }

        // Add duplicate numbers to usedNumbersOverall
        foreach (var duplicate in duplicates)
        {
            if (!usedNumbersOverall.Contains(duplicate))
            {
                usedNumbersOverall.Add(duplicate);
            }
        }
        if (mainSelectedIndexes[randomeSelectedPatternClass].intList.Count > 0)
        {
            for (int m = 0; m < cardClasses.Length; m++)
            {
                // Debug.Log("Number at numberToUse : " + cardClasses[m].numb);
                if (PatternDoneClass == cardClasses[m].cardNo)
                {
                   // Debug.Log("randomSkipIndex ------ " + randomSkipIndex);
                    //int ind = cardClasses[PatternDoneClass].numb[randomSkipIndex];
                    int ind = mainSelectedIndexes[randomeSelectedPatternClass].intList[randomSkipIndex];
                    extraballMatchingNo = cardClasses[PatternDoneClass].numb[ind];
                    // Debug.Log("index ------ " + ind);
                    // Debug.Log("MissingNo ------ " + extraballMatchingNo);
                    // Debug.Log("PatternDoneClass ::------ " + PatternDoneClass);
                    // extraballMatchingNo = cardClasses[PatternDoneClass].numb[ind];
                    // Debug.Log("PatternDoneClass :" + PatternDoneClass + " numberAtIndex : " + extraballMatchingNo);

                    break;
                }

            }
        }
        if (duplicates.Count > 0)
        {
            Debug.LogWarning("Duplicate numbers found across card classes: " + string.Join(", ", duplicates));
        }
        else
        {
            // Debug.Log("No duplicates found across card classes.");
        }
        CheckAndCompleteFakePatterns(_cardno, incompletefakeSelectedIndex);
    }

    
    public void CheckAndCompleteFakePatterns(int CardNo, int IncompletePattern)
    {
        extrafakeNO.Clear();
        int no;
        for(int i = 0 ; i < cardClasses.Length ; i++)
        {
            if(i == CardNo)
            {
                for (int j = 0; j < noWinPattern[IncompletePattern].fakeindex.Count; j++)
                {
                    int currentFakeIndex = noWinPattern[IncompletePattern].fakeindex[j];
                    
                    // Check if the currentFakeIndex is NOT in incompleteID
                    if(!incompleteID.Contains(currentFakeIndex))
                    {
                        no = cardClasses[CardNo].numb[currentFakeIndex];
                        //Debug.Log("!!!!!!!! : " + cardClasses[CardNo].numb[currentFakeIndex] );
                        extrafakeNO.Add(no);
                    }
                }
            }
        }
    }

    public static void Shuffle<T>(List<T> list)
    {
        System.Random rng = new System.Random();
        int n = list.Count;

        while (n > 1)
        {
            n--;
            int k = rng.Next(n + 1);
            T value = list[k];
            list[k] = list[n];
            list[n] = value;
        }
    }
    public void ShowExtraBallOnTap(int extraballCount)
    {
        Debug.Log("-------showFreeExtraBalls : " + showFreeExtraBalls);
        //if (isExtraBallDone) { return; }
        totalExtraBallCount = extraballCount;

        extraBallCountText.text = extraballCount.ToString();
        EventManager.TapForExtraBall(true);
        //isExtraBallDone = true;
    }

    public void TapOnExtraBall()
    {
        generatedNO = Numbgen(generatedNO, generatedNO.Count + 1);
        if (totalExtraBallCount > 0)
        {
            if (totalExtraBallCount == 1)
            {
                EventManager.TapForExtraBall(false);
            }
            EventManager.GenerateExtraBall(generatedNO, true, false);
        }

        totalExtraBallCount--;
        slotController.extraBallCount--;
        extraBallCountText.text = totalExtraBallCount.ToString();
    }
    public void ShowFreeExtraBalls(int extraballCount)
    { 
        List<int> extraballNO = new();
        if (UnityEngine.Random.Range(0, 2) == 0)
        {
            if (!generatedNO.Contains(extraballMatchingNo))
            {
                extraballNO.Add(extraballMatchingNo);
                //generatedNO.Add(extraballMatchingNo);
                // Debug.Log("extraball Comminggggg ----------> ");
            }
        }

        //Debug.Log("extraballCounttttttt ----------> " + (extraballCount - 1));

        for (int i = 0; i < (extraballCount - 1); i++)
        {
            if (i < extrafakeNO.Count && !generatedNO.Contains(extrafakeNO[i]))
            {
                //sgeneratedNO.Add(extrafakeNO[i]);
                extraballNO.Add(extrafakeNO[i]);
            }
        }
        Shuffle(extraballNO);

        for (int i = 0; i < extraballNO.Count; i++)
        {
            if (i < extraballNO.Count && !generatedNO.Contains(extraballNO[i]))
            {
                generatedNO.Add(extraballNO[i]);
            }
        }
        //Debug.Log("Check ----------> " + string.Join(", ", generatedNO));
        EventManager.GenerateExtraBall(generatedNO, isMissingPattern, showFreeExtraBalls);
    }

    private void Shuffle(List<int> list)
    {
        for (int i = 0; i < list.Count; i++)
        {
            int randomIndex = UnityEngine.Random.Range(i, list.Count); // Pick a random index from i to end
            int temp = list[i];
            list[i] = list[randomIndex];
            list[randomIndex] = temp;
        }
    }
    public static List<int> Numbgen(List<int> numblist, int loopCount)
    {
        int no = 0;
        while (numblist.Count != loopCount)
        {
            no = UnityEngine.Random.Range(1, 61);

            if (!numblist.Contains(no))
            {
                numblist.Add(no);
            }
        }

        return numblist;
    }

    public void CheckSelectedNumb(int num)
    {
        for (int i = 0; i < totalActiveCard; i++)
        {
            if (cardClasses[i].numb.Contains(generatedNO[num]))
            {
                int index = cardClasses[i].numb.IndexOf(generatedNO[num]);
                cardClasses[i].selectionImg[index].SetActive(true);
                cardClasses[i].payLinePattern[index] = 1;
                CheckPayLineMatch(i);
            }
            if (num == 29)
            {

                if (isPrizeMissedByOneCard)
                {
                    //Invoke(nameof(ShowExtraBalls), 1);
                    Invoke(nameof(StartExtraBallScreen), 2);
                }
                else
                {
                    EventManager.AutoSpinOver(true);
                    EndGame();
                    isExtraBallDone = true;
                }

            }
        }
    }

    void StartExtraBallScreen()
    {
        if (isExtraBallDone) { return; }
        //Debug.Log("isMissingPattern ------------>>>> " + isMissingPattern);
        Invoke("ShowExtraBallSlotMachine", 2);
        if (!showFreeExtraBalls && !isBonusSelected)
        {
            Invoke("ShowExtraBallSlotMachine", 2);

        }
        else if (showFreeExtraBalls && !isBonusSelected && totalExtraBallCount != 0)
        {
            Invoke("DropBallsFromExtraBallBank", 2);
        }
        EndGame();
        isExtraBallDone = true;
    }

    void ShowExtraBallSlotMachine()
    {
        // Debug.Log("ShowExtraBallSlotMachine Called");
        if (totalExtraBallCount < 50)
        {
           // Debug.Log("totalExtraBallCount is  < 50");
            extraBallObj.SetActive(true);
        }
        else
        {
             extraBallObj.SetActive(false);
           //  Debug.Log("totalExtraBallCount is  > Greater 50");
        }

        EventManager.AutoSpinOver(true);
    }

    void DropBallsFromExtraBallBank()
    {
        if (totalExtraBallCount <= 5)
        {
            ShowFreeExtraBalls(totalExtraBallCount);
        }
        else
        {
            ShowFreeExtraBalls(5);
        }
    }

    public void ShowMatchedPaylinePatternsForCurrentCards(bool onlyFirstMatchPerCard = false)
    {
        RealtimePaylineUtils.ShowMatchedPaylinePatternsForCurrentCards(
            cardClasses,
            patternList,
            onlyFirstMatchPerCard,
            matchedMat,
            unMatchedMat);
    }

    public void ClearPaylineVisuals()
    {
        RealtimePaylineUtils.ClearPaylineVisuals(cardClasses);
    }

    public void CheckPayLineMatch(int cardNo)
    {
        RealtimePaylineUtils.EnsurePaylineIndexCapacity(cardClasses[cardNo], patternList.Count);

        for (int patternIndex = 0; patternIndex < patternList.Count; patternIndex++)
        {
            if (!cardClasses[cardNo].paylineindex[patternIndex])
            {

                int count = 0;
                if (selectedIndex != null) selectedIndex.Clear();
                for (int a = 0; a < totalNumInEachCard; a++)
                {
                    if (patternList[patternIndex].pattern[a] == 1 && cardClasses[cardNo].payLinePattern[a] == 1)
                    {
                        count++;
                        if (!cardClasses[cardNo].selectedPayLineCanBe.ContainsKey(patternIndex))
                        {
                            cardClasses[cardNo].selectedPayLineCanBe.Add(patternIndex, count);
                        }
                        else
                        {
                            cardClasses[cardNo].selectedPayLineCanBe[patternIndex] = count;
                        }
                        selectedIndex.Add(a);
                        selectedCard.Add(cardNo);
                        if (count == patternList[patternIndex].totalCountOfTrue)
                        {
                            PrizeWin(cardNo, patternIndex);
                        }
                        else if (count == patternList[patternIndex].totalCountOfTrue - 1)
                        {
                            PrizeMissedByOneCard(cardNo, patternIndex);
                        }
                        else
                        {
                            if (ballAnimSpeed < 0.3f)
                                ballAnimSpeed += 0.0005f;
                        }
                    }
                }
            }
        }


    }

    //Won the Prize
    public void PrizeWin(int cardNo, int patternIndex)
    {
        RealtimePaylineUtils.EnsurePaylineIndexCapacity(cardClasses[cardNo], patternIndex + 1);
        cardClasses[cardNo].paylineindex[patternIndex] = true;
        RealtimePaylineUtils.SetPaylineVisual(
            cardClasses,
            cardNo,
            patternIndex,
            true,
            true,
            matchedMat,
            unMatchedMat);
        EventManager.ShowMatchedPattern(patternIndex, true);
        for (int m = 0; m < selectedIndex.Count; m++)
        {
            cardClasses[cardNo].matchPatternImg[selectedIndex[m]].SetActive(true);
            ballAnimSpeed = 0.11f;
            EventManager.ShowMissingPattern(patternIndex, selectedIndex[m], false);
        }

        if (patternIndex < 10)
        {
            isMissingPattern = true;
        }

        if (patternIndex == 1)
        {
            isBonusSelected = true;
        }
        else
        {
            EventManager.AddWinAmt(cardNo, patternIndex);
        }
    }

    //Almost Win
    public void PrizeMissedByOneCard(int cardNo, int patternIndex)
    {
        for (int blockCount = 0; blockCount < totalNumInEachCard; blockCount++)
        {
            if (patternList[patternIndex].pattern[blockCount] == 1 && cardClasses[cardNo].payLinePattern[blockCount] == 0)
            {
                RealtimePaylineUtils.SetPaylineVisual(
                    cardClasses,
                    cardNo,
                    patternIndex,
                    true,
                    false,
                    matchedMat,
                    unMatchedMat);

                EventManager.ShowMissingPattern(patternIndex, blockCount, true);
                TextMeshProUGUI missingPatternPrize = cardClasses[cardNo].missingPatternImg[blockCount].transform.GetChild(0).GetComponentInChildren<TextMeshProUGUI>();
                TextMeshProUGUI patternIndexInTopper = topperManager.prizes[topperManager.GetPatternIndex(patternIndex)];
                if (cardClasses[cardNo].missingPatternImg[blockCount].activeInHierarchy && !missingPatternPrize.text.Contains(patternIndexInTopper.text))
                {
                    //missingPatternPrize.text += ", " + patternIndexInTopper.text;
                    //Debug.Log(missingPatternPrize.text + " + " + patternIndexInTopper.text);
                    int totalLoss = int.Parse(missingPatternPrize.text) + int.Parse(patternIndexInTopper.text);
                    missingPatternPrize.text = totalLoss.ToString();
                    // Debug.Log("total : " + missingPatternPrize.text);
                }
                else
                {
                    missingPatternPrize.text = patternIndexInTopper.text;
                    cardClasses[cardNo].missingPatternImg[blockCount].SetActive(true);
                }

                if (topperManager.GetPatternIndex(patternIndex) < 8)
                {
                    showFreeExtraBalls = true;
                    isMissingPattern = true;
                }

            }
        }
    }



    public static bool isPrizeMissedByOneCard;
    
    public float ballAnimSpeed = 0.11f;
    List<int> selectedIndex = new List<int>();
    public bool isMissingPattern;
    List<int> selectedCard = new List<int>();



    private void EndGame()
    {
        if (isBonusSelected)
        {
            Invoke(nameof(StartBonus), 1);
        }
        else
        {
            NextPlay();
        }
    }


    bool isBonusSelected;

    void StartBonus()
    {
        bonusMainObj.SetActive(true);
    }


    void ResetNumb()
    {
        isShowTimer = false;
        isPrizeMissedByOneCard = false;
        showFreeExtraBalls = false;
        isMissingPattern = false;
        StopAllCoroutines();
        if (random.Count != 0) random.Clear();
        if (generatedNO.Count != 0) generatedNO.Clear();
        ClearPaylineVisuals();

        for (int i = 0; i < cardClasses.Length; i++)
        {
            if (cardClasses[i].numb.Count != 0) cardClasses[i].numb.Clear();
            cardClasses[i].selectionImg.ForEach(p => p.SetActive(false));
            cardClasses[i].missingPatternImg.ForEach(p => p.SetActive(false));
            cardClasses[i].matchPatternImg.ForEach(p => p.SetActive(false));
            if (cardClasses[i].paylineindex.Count != 0) cardClasses[i].paylineindex.Clear();

            for (int j = 0; j < cardClasses[i].payLinePattern.Count; j++)
            {
                cardClasses[i].payLinePattern[j] = 0;
            }
            if (cardClasses[i].selectedPayLineCanBe.Count != 0) cardClasses[i].selectedPayLineCanBe.Clear();
        }
        //extraBalls[0].transform.parent.gameObject.SetActive(false);


        ballAnimSpeed = 0.1f;
        isExtraBallDone = false;
        //EventManager.Play();
    }


    float getGameTime(/* int secodsDayDurationInGame */)
    {
        // float scaledElapsedSecondInGame = secondsOfARealDay / secodsDayDurationInGame; // second equivalent in your game 
        float elapsedRealTime = Time.time - startingGameTime; // uncomment to calculate with elapsed real time.
                                                              // Debug.Log("elapsedRealTime  " + elapsedRealTime);
                                                              // DateTime gateDateTime = startingGameDate.AddSeconds(elapsedRealTime * scaledElapsedSecondInGame);

        return elapsedRealTime;
    }

    public static bool isShowTimer = false;

    void ShowTimer()
    {
        isShowTimer = true;
    }

    int remTime = 0;

    private void FixedUpdate()
    {
        if (!EventManager.isPlayOver || isExtraBallDone)
        {
            remTime = 30 - (int)(getGameTime());
            if (remTime >= 1 && isShowTimer)
            {
                autoSpinRemainingPlayText.text = remTime.ToString();
            }
        }
    }

}



[System.Serializable]
public class CardClass
{
    public int cardNo;
    public bool isCardActive;
    public List<int> numb = new List<int>();
    public List<TextMeshProUGUI> num_text = new List<TextMeshProUGUI>();
    public List<GameObject> selectionImg = new List<GameObject>();
    public List<GameObject> missingPatternImg = new List<GameObject>();
    public List<GameObject> matchPatternImg = new List<GameObject>();
    public List<byte> payLinePattern = new List<byte>(15);
    public Dictionary<int, int> selectedPayLineCanBe = new Dictionary<int, int>();
    public List<GameObject> paylineObj;
    public List<bool> paylineindex = new List<bool>();
    public TextMeshProUGUI win;
}
