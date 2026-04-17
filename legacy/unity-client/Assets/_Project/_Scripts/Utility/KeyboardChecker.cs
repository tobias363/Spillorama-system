using UnityEngine;
using UnityEngine.InputSystem;


public class KeyboardChecker : MonoBehaviour
{
    void Start()
    {
        bool isKeyboardConnected = CheckKeyboardAttached();

        if (isKeyboardConnected)
        {
            Debug.Log("Physical keyboard is attached.");
        }
        else
        {
            Debug.Log("No physical keyboard detected.");
        }
    }

    public bool CheckKeyboardAttached()
    {
        // Check if there is at least one device that is a Keyboard
        if (Keyboard.current != null)
        {
            Debug.Log("A physical or virtual keyboard is available/current.");
            // Further checks needed to distinguish physical from virtual on some mobile platforms
        }
        else
        {
            Debug.Log("No keyboard device is currently available.");
        }
        return false;
    }

}
