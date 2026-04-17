using System;
using System.Threading;

public static class FileDialogSTA
{
    public static T Run<T>(Func<T> action)
    {
        T result = default;
        Exception exception = null;

        Thread t = new Thread(() =>
        {
            try
            {
                result = action();
            }
            catch (Exception ex)
            {
                exception = ex;
            }
        });

        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();

        if (exception != null)
            throw exception;

        return result;
    }
} 