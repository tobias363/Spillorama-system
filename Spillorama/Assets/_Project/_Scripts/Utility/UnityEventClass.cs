using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

[System.Serializable]
public class CustomUnityEventInt : UnityEvent<int> { }

[System.Serializable]
public class CustomUnityEventString : UnityEvent<string> { }

[System.Serializable]
public class CustomUnityEventSprite : UnityEvent<Sprite> { }

[System.Serializable]
public class OnImageSelected : UnityEvent<Texture2D> { }

[System.Serializable]
public class CustomUnityEventHallList : UnityEvent<List<HallData>> { }

[System.Serializable]
public class CustomUnityEventCountryList : UnityEvent<List<string>> { }